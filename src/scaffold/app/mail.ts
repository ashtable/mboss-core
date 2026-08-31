// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import type { NodeEmail } from './contract.js';
import { renderNodeEmail } from './email/templates.js';
import { readEnv } from './env.js';
import { mintArtifactLink, mintFormLink } from './links.js';
import { createTwilioEmailMailer, type Mailer } from './mailer.js';
import { parseKeyRing, type LinkKeyRing } from './signed-links.js';

/**
 * The one call a workflow makes to send anything.
 *
 * It mints the link, renders the template and
 * sends, all three inside the step the workflow
 * wrapped around this call. Minting is why they
 * are together: a token's issued and expiry times
 * come from the clock, so a workflow body that
 * minted its own link would produce a different
 * token every time the run replayed and the
 * recipient would be holding one that no longer
 * matched. Generated workflow code therefore
 * contains no minting call at all.
 */

export type MailDeps = {
  ring: LinkKeyRing;
  /** The origin links are minted against. */
  baseUrl: string;
  /** The name people see on the card. */
  appTitle: string;
  mailer: Mailer;
  /** Milliseconds since the epoch. A parameter, so
   *  that a test can pin what was minted. */
  now: () => number;
};

let shared: MailDeps | undefined;

/**
 * What the app sends with, built once from the
 * environment on first use. Built lazily so that
 * importing this module reads nothing.
 */
function defaultDeps(): MailDeps {
  if (shared) return shared;

  const env = readEnv(process.env);
  shared = {
    ring: parseKeyRing(env.LINK_KEYS),
    baseUrl: env.APP_BASE_URL,
    appTitle: env.APP_NAME,
    mailer: createTwilioEmailMailer({
      apiKey: env.TWILIO_API_KEY,
      apiSecret: env.TWILIO_API_SECRET,
      baseUrl: env.TWILIO_EMAIL_BASE_URL,
      from: env.MAIL_FROM,
      fromName: env.APP_NAME,
    }),
    now: () => Date.now(),
  };

  return shared;
}

export async function sendNodeEmail(
  input: NodeEmail,
  deps: MailDeps = defaultDeps(),
): Promise<void> {
  await deps.mailer.send(
    renderNodeEmail({
      email: input,
      appTitle: deps.appTitle,
      linkUrl: linkFor(input, deps),
    }),
  );
}

/**
 * The one link the message carries, or null.
 *
 * An approval mints an ordinary form token: which
 * of the two pages a link opens is settled by the
 * workflow's own list of waits, never by the
 * token, which is what lets one route serve both.
 */
function linkFor(input: NodeEmail, deps: MailDeps): string | null {
  const { attach } = input;
  const common = {
    ring: deps.ring,
    baseUrl: deps.baseUrl,
    to: input.to,
    now: deps.now(),
  };

  switch (attach.kind) {
    case 'form':
    case 'approval':
      return mintFormLink({
        ...common,
        runId: input.runId,
        // The wait's node, which is not always the
        // node that sends the mail.
        nodeId: attach.nodeId,
        expiresInSeconds: attach.expiresInSeconds,
      });
    case 'artifact':
      return mintArtifactLink({
        ...common,
        key: attach.key,
        expiresInSeconds: attach.expiresInSeconds,
      });
    case 'none':
      return null;
  }
}
