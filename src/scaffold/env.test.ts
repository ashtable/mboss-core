import { describe, expect, it } from 'vitest';

import { EnvSchema, readEnv } from './app/env.js';
import { scaffoldFiles } from './files.js';

/**
 * The two environment files, against the schema
 * the app boots on.
 *
 * A variable named in one and not the other is a
 * boot failure in somebody else's project — the
 * one class of bug no golden and no type-check
 * here can see, because both halves are text until
 * the app runs.
 */

const FILES = scaffoldFiles({
  name: 'my_app',
  linkKeys: `k1:${'ab'.repeat(32)}`,
  eventsSecret: 'test-events-secret',
});

function contentsOf(path: string): string {
  const found = FILES.find((file) => file.path === path);
  if (!found) throw new Error(`nothing emitted at ${path}`);

  return found.contents;
}

/**
 * Every variable a file names, set or commented
 * out. A commented-out line still names the
 * variable — that is how the file says "optional,
 * turn this on if you want it" — so both count.
 */
function namedIn(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

/** Only the variables a process would actually
 *  receive: the uncommented ones, unquoted. */
function settingsIn(text: string): Record<string, string> {
  const found: Record<string, string> = {};

  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)="?(.*?)"?$/.exec(line.trim());
    if (match?.[1] !== undefined) found[match[1]] = match[2] ?? '';
  }

  return found;
}

const ENV = contentsOf('.env');
const EXAMPLE = contentsOf('.env.example');
const SCHEMA_KEYS = Object.keys(EnvSchema.shape).sort();

describe('the variable set', () => {
  it('names every variable this app is documented to read', () => {
    expect(namedIn(EXAMPLE)).toEqual([
      'APP_BASE_URL',
      'APP_VERSION',
      'DATABASE_URL',
      'DBOS_SYSTEM_DATABASE_URL',
      'EVENTS_SECRET',
      'GLOO_AI_CLIENT_ID',
      'GLOO_AI_CLIENT_SECRET',
      'LINK_KEYS',
      'MAIL_FROM',
      'PORT',
      'S3_ACCESS_KEY_ID',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_SECRET_ACCESS_KEY',
      'TWILIO_API_KEY',
      'TWILIO_API_SECRET',
      'TWILIO_EMAIL_BASE_URL',
    ]);
  });

  it('is exactly the schema the app reads, neither more nor less', () => {
    expect(namedIn(EXAMPLE)).toEqual(SCHEMA_KEYS);
    expect(namedIn(ENV)).toEqual(SCHEMA_KEYS);
  });
});

describe('the example file', () => {
  it('carries no minted secret', () => {
    expect(EXAMPLE).not.toContain('ab'.repeat(32));
    expect(EXAMPLE).not.toContain('test-events-secret');
  });

  it('carries a key ring that parses, so a boot fails on a signature', () => {
    expect(readEnv(settingsIn(EXAMPLE)).LINK_KEYS).toMatch(/^k1:[0-9a-f]{64}$/);
  });
});

describe('the real file', () => {
  it('carries the secrets that were minted for this project', () => {
    expect(settingsIn(ENV).LINK_KEYS).toBe(`k1:${'ab'.repeat(32)}`);
    expect(settingsIn(ENV).EVENTS_SECRET).toBe('test-events-secret');
  });

  it('boots the app without a single hand edit', () => {
    const env = readEnv(settingsIn(ENV));

    expect(env.PORT).toBe(3000);
    expect(env.APP_BASE_URL).toBe('http://localhost:3000');
  });

  it('gives every required variable a value that is really there', () => {
    const settings = settingsIn(ENV);

    for (const key of requiredKeys()) {
      expect(settings[key] ?? '').not.toBe('');
    }
  });

  it('requires exactly the eight an app cannot run without', () => {
    // Derived from the schema rather than listed
    // twice: a variable that quietly became
    // required would otherwise pass a list that
    // was written before it did.
    expect(requiredKeys()).toEqual([
      'APP_BASE_URL',
      'DATABASE_URL',
      'DBOS_SYSTEM_DATABASE_URL',
      'EVENTS_SECRET',
      'LINK_KEYS',
      'MAIL_FROM',
      'TWILIO_API_KEY',
      'TWILIO_API_SECRET',
    ]);
  });
});

/**
 * Which variables the schema refuses to do
 * without: drop one from a working environment and
 * see whether the parse survives.
 */
function requiredKeys(): string[] {
  const complete = settingsIn(ENV);

  return SCHEMA_KEYS.filter((key) => {
    const without = { ...complete };
    delete without[key];

    return !EnvSchema.safeParse(without).success;
  });
}
