import { describe, expect, it } from 'vitest';

import { EnvSchema, readEnv } from './env.js';

/**
 * The environment a generated app boots on.
 *
 * The schema and the emitted `.env.example` have
 * to name the same variables — a mismatch is a
 * boot failure in somebody else's project, which
 * is the one class of bug nothing else in this
 * repo can see. `files.test.ts` compares the two
 * key sets; this file is about what each variable
 * means.
 */

const COMPLETE = {
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  DBOS_SYSTEM_DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  APP_BASE_URL: 'http://localhost:3000',
  APP_NAME: 'my_app',
  LINK_KEYS:
    'k1:00000000000000000000000000000000000000000000000000000000000001',
  EVENTS_SECRET: 'deadbeef',
  MAIL_FROM: 'hello@example.com',
  TWILIO_API_KEY: 'SK-dev-twilio-api-key',
  TWILIO_API_SECRET: 'dev-twilio-api-secret',
};

describe('readEnv', () => {
  it('accepts an environment carrying only the required set', () => {
    expect(readEnv(COMPLETE).DATABASE_URL).toBe(COMPLETE.DATABASE_URL);
  });

  it('names every missing variable at once, not the first', () => {
    let message = '';
    try {
      readEnv({ DATABASE_URL: 'postgres://x' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('APP_NAME');
    expect(message).toContain('LINK_KEYS');
    expect(message).toContain('EVENTS_SECRET');
    expect(message).toContain('MAIL_FROM');
    expect(message).toContain('TWILIO_API_SECRET');
  });

  it('defaults the application version to one', () => {
    expect(readEnv(COMPLETE).APP_VERSION).toBe('1');
  });

  it('defaults the port to 3000 and coerces the string form', () => {
    expect(readEnv(COMPLETE).PORT).toBe(3000);
    expect(readEnv({ ...COMPLETE, PORT: '8080' }).PORT).toBe(8080);
  });

  it('defaults the mail base URL to the provider', () => {
    expect(readEnv(COMPLETE).TWILIO_EMAIL_BASE_URL).toBe(
      'https://comms.twilio.com',
    );
  });

  it('strips trailing slashes off both base URLs', () => {
    const env = readEnv({
      ...COMPLETE,
      APP_BASE_URL: 'https://app.example.com//',
      TWILIO_EMAIL_BASE_URL: 'http://localhost:4010/',
    });

    expect(env.APP_BASE_URL).toBe('https://app.example.com');
    expect(env.TWILIO_EMAIL_BASE_URL).toBe('http://localhost:4010');
  });

  it('treats the object store and the model credentials as optional', () => {
    const env = readEnv(COMPLETE);

    expect(env.S3_BUCKET).toBeUndefined();
    expect(env.GLOO_AI_CLIENT_ID).toBeUndefined();
  });

  it('reads an object store configuration when one is given', () => {
    const env = readEnv({
      ...COMPLETE,
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'artifacts',
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadmin',
    });

    expect(env.S3_BUCKET).toBe('artifacts');
  });
});

describe('the schema itself', () => {
  it('stays a plain object, so its keys can be read off it', () => {
    // `files.test.ts` compares this key set
    // against the emitted `.env.example`. A
    // `.transform()` at the object level would
    // turn it into a pipe with no `shape`, and
    // that comparison would have to go looking
    // for the keys in the source text instead.
    const keys = Object.keys(EnvSchema.shape);

    expect(keys).toContain('DATABASE_URL');
    expect(keys).toHaveLength(19);
  });
});
