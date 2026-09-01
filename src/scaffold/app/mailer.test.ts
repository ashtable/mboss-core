import { describe, expect, it } from 'vitest';

import {
  MailSendError,
  createTwilioEmailMailer,
  isMailSendRefusal,
  isTransientSendFailure,
  type MailerConfig,
} from './mailer.js';

/**
 * The client that actually sends the mail.
 *
 * It is hand-rolled rather than taken from a
 * vendor package for one reason that shows up in
 * every test here: the API root is a parameter, so
 * a local run can point at a mail sink and take
 * the same code path a real send takes. A vendor
 * client would take that away.
 *
 * `fetchImpl` is an ordinary parameter with a
 * production default rather than a test hatch, and
 * these tests hand in a transport that records
 * instead of opening a socket.
 */

const CONFIG: MailerConfig = {
  apiKey: 'SK-key',
  apiSecret: 'secret',
  baseUrl: 'https://sink.example.com',
  from: 'hello@example.com',
  fromName: 'Sermon Helper',
};

const MESSAGE = {
  to: 'sam@hillsong.io',
  subject: 'Your form is ready',
  html: '<p>hello</p>',
};

type Call = { url: string; init: RequestInit };

function recording(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });

    return {
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof globalThis.fetch;

  return { calls, fetchImpl };
}

const ACCEPTED = {
  operationId: 'OP123',
  operationLocation: 'https://comms.twilio.com/v1/Emails/OP123',
};

describe('an accepted send', () => {
  it('returns the receipt the provider parsed cleanly', async () => {
    const { fetchImpl } = recording(202, ACCEPTED);
    const mailer = createTwilioEmailMailer(CONFIG, fetchImpl);

    expect(await mailer.send(MESSAGE)).toEqual(ACCEPTED);
  });

  it('posts to the versioned path under the configured root', async () => {
    const { calls, fetchImpl } = recording(202, ACCEPTED);
    await createTwilioEmailMailer(CONFIG, fetchImpl).send(MESSAGE);

    expect(calls[0]?.url).toBe('https://sink.example.com/v1/Emails');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('authenticates with the key pair, as HTTP basic', async () => {
    const { calls, fetchImpl } = recording(202, ACCEPTED);
    await createTwilioEmailMailer(CONFIG, fetchImpl).send(MESSAGE);

    const expected = Buffer.from('SK-key:secret').toString('base64');
    const headers = calls[0]?.init.headers as Record<string, string>;

    expect(headers.authorization).toBe(`Basic ${expected}`);
    expect(headers['content-type']).toBe('application/json');
  });

  it('sends the shape the API documents, and no plain-text part', async () => {
    const { calls, fetchImpl } = recording(202, ACCEPTED);
    await createTwilioEmailMailer(CONFIG, fetchImpl).send(MESSAGE);

    const body = JSON.parse(String(calls[0]?.init.body));

    expect(body).toEqual({
      from: { address: 'hello@example.com', name: 'Sermon Helper' },
      to: [{ address: 'sam@hillsong.io' }],
      content: { subject: 'Your form is ready', html: '<p>hello</p>' },
    });
    expect(body.content.text).toBeUndefined();
  });

  it('refuses a body that does not look like a receipt', async () => {
    // Parsed rather than trusted: a drift between
    // the provider's shape and this one has to
    // surface at the send, not as an undefined
    // operation id somewhere downstream.
    const { fetchImpl } = recording(202, { nothing: 'useful' });

    await expect(
      createTwilioEmailMailer(CONFIG, fetchImpl).send(MESSAGE),
    ).rejects.toThrow();
  });
});

describe('a refused send', () => {
  it('throws with the status, and the provider s own wording', async () => {
    const { fetchImpl } = recording(400, { message: 'from address unknown' });

    await expect(
      createTwilioEmailMailer(CONFIG, fetchImpl).send(MESSAGE),
    ).rejects.toMatchObject({
      name: 'MailSendError',
      code: 400,
      message: 'from address unknown',
    });
  });

  it('falls back to the bare status when it offered no wording', async () => {
    const { fetchImpl } = recording(500, undefined);

    await expect(
      createTwilioEmailMailer(CONFIG, fetchImpl).send(MESSAGE),
    ).rejects.toMatchObject({ code: 500, message: 'HTTP 500' });
  });

  it('treats anything but the accepted status as a refusal', async () => {
    const { fetchImpl } = recording(200, ACCEPTED);

    await expect(
      createTwilioEmailMailer(CONFIG, fetchImpl).send(MESSAGE),
    ).rejects.toMatchObject({ code: 200 });
  });
});

describe('isMailSendRefusal', () => {
  it('recognises one by its shape, not by its class', () => {
    // A refusal a workflow inspects may have
    // crossed a durable checkpoint, and what comes
    // back has lost its prototype. `instanceof`
    // would answer true the first time and false
    // on every replay.
    const replayed = { name: 'MailSendError', code: 400, message: 'no' };

    expect(isMailSendRefusal(new MailSendError(400, 'no'))).toBe(true);
    expect(isMailSendRefusal(replayed)).toBe(true);
  });

  it('says no to anything else', () => {
    expect(isMailSendRefusal(new Error('no'))).toBe(false);
    expect(isMailSendRefusal({ name: 'MailSendError' })).toBe(false);
    expect(isMailSendRefusal(null)).toBe(false);
  });
});

describe('isTransientSendFailure', () => {
  it('retries a rate limit and a provider-side failure', () => {
    expect(isTransientSendFailure(new MailSendError(429, 'slow down'))).toBe(
      true,
    );
    expect(isTransientSendFailure(new MailSendError(500, 'oops'))).toBe(true);
    expect(isTransientSendFailure(new MailSendError(503, 'oops'))).toBe(true);
  });

  it('retries a throw that never reached the provider', () => {
    expect(isTransientSendFailure(new Error('socket hang up'))).toBe(true);
    expect(isTransientSendFailure('something odd')).toBe(true);
  });

  it('never retries a complaint about the message itself', () => {
    expect(isTransientSendFailure(new MailSendError(400, 'bad from'))).toBe(
      false,
    );
    expect(isTransientSendFailure(new MailSendError(403, 'no'))).toBe(false);
  });
});
