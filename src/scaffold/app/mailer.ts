// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { z } from 'zod';

import type { EmailMessage } from './email/message.js';

/**
 * The one place this app talks to Twilio Email.
 *
 * It is hand-rolled rather than a vendor package,
 * and the reason is the `baseUrl` below: pointing
 * it at a mail sink is how a local run exercises
 * the same code path a real send takes. A vendor
 * client hides that behind its own configuration
 * or does not offer it at all.
 *
 * The interface is small enough that every test
 * elsewhere in this app can hand the workflows a
 * recording double instead of this.
 */
export type Mailer = {
  send(message: EmailMessage): Promise<SendReceipt>;
};

/**
 * What the provider hands back for an accepted
 * send. Acceptance is not delivery — the message
 * is queued, and `operationId` is the only handle
 * anything has on where it ends up.
 */
export type SendReceipt = {
  operationId: string;
  operationLocation: string;
};

export type MailerConfig = {
  /**
   * An API key pair rather than the account
   * credentials, so this app's access can be
   * revoked on its own.
   */
  apiKey: string;
  apiSecret: string;
  /** The API root, without the version segment. */
  baseUrl: string;
  /** The address mail is sent from, and the name
   *  beside it in an inbox. */
  from: string;
  fromName: string;
};

const MAIL_SEND_ERROR_NAME = 'MailSendError';

/** The one status that means accepted. */
const ACCEPTED = 202;

/**
 * A send the provider refused. `code` is the HTTP
 * status, named to match what
 * `isTransientSendFailure` reads.
 */
export class MailSendError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = MAIL_SEND_ERROR_NAME;
    this.code = code;
  }
}

/**
 * Whether a value is one of those refusals, read
 * by shape rather than by class.
 *
 * A refusal that a workflow inspects may have
 * crossed a durable checkpoint on the way. DBOS
 * records a failed step's error and re-throws it
 * on every later replay, and what comes back is a
 * bare error with this class's prototype gone. So
 * `instanceof` answers true on the first attempt
 * and false on every recovery of the same run,
 * which is the one moment the answer has to hold.
 */
export function isMailSendRefusal(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const shape = value as { name?: unknown; code?: unknown };
  return shape.name === MAIL_SEND_ERROR_NAME && typeof shape.code === 'number';
}

/**
 * The accepted-send body is parsed rather than
 * trusted, so a drift between the provider's shape
 * and this one surfaces at the send rather than as
 * an undefined operation id somewhere later.
 */
const SendAcceptedSchema = z.object({
  operationId: z.string().min(1),
  operationLocation: z.string().min(1),
});

/**
 * `fetchImpl` is an ordinary dependency with a
 * production default, not a test hatch.
 */
export function createTwilioEmailMailer(
  config: MailerConfig,
  fetchImpl?: typeof globalThis.fetch,
): Mailer {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const credentials = Buffer.from(
    `${config.apiKey}:${config.apiSecret}`,
  ).toString('base64');

  return {
    async send(message: EmailMessage): Promise<SendReceipt> {
      const response = await doFetch(`${config.baseUrl}/v1/Emails`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: { address: config.from, name: config.fromName },
          to: [{ address: message.to }],
          // No `text`: the provider derives the
          // plain-text part from the HTML, and
          // generating our own would be a second
          // rendering of every template to keep in
          // step with the first.
          content: {
            subject: message.subject,
            html: message.html,
            ...(message.headers === undefined
              ? {}
              : { headers: message.headers }),
          },
        }),
      });

      const payload: unknown = await response.json().catch(() => undefined);
      // Anything else is a refusal. The API answers
      // an accepted send with that status and
      // nothing else.
      if (response.status !== ACCEPTED) {
        throw new MailSendError(
          response.status,
          refusalMessage(payload, response.status),
        );
      }

      return SendAcceptedSchema.parse(payload);
    },
  };
}

/**
 * Whether a refused send is worth another try.
 *
 * A rate limit or a failure on the provider's side
 * will likely pass next time. Any other refusal in
 * the four hundreds is a complaint about the
 * message itself, and resending it unchanged only
 * delays the failure. A throw with no status at
 * all never reached the provider, which is the
 * transient case retries exist for.
 */
export function isTransientSendFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;

  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'number') return true;

  return code === 429 || code >= 500;
}

/**
 * The provider's own wording for a refusal, or the
 * bare status when it offered none.
 */
export function refusalMessage(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const shape = payload as { message?: unknown };
    if (typeof shape.message === 'string') return shape.message;
  }

  return `HTTP ${status}`;
}
