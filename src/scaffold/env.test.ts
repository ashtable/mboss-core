import { describe, expect, it } from 'vitest';

import { EnvSchema, readEnv } from './app/env.js';
import { parseKeyRing } from './app/signed-links.js';
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
      'APP_NAME',
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

  it('refuses to boot, rather than serving links anyone can forge', () => {
    // `.env` is gitignored, so the second person to
    // clone a generated project has none and copies
    // this one. Values that worked would bring the
    // app up green with every form and artifact
    // token in the world forgeable by anybody who
    // has read mBoss's source, and its event
    // ingress open to them too.
    expect(() => readEnv(settingsIn(EXAMPLE))).toThrow(/EVENTS_SECRET/);
  });

  it('carries no signing ring either, and dies naming the entry', () => {
    // The app parses the ring during start-up, so
    // this one stops there rather than on the first
    // link it tries to mint.
    expect(() => parseKeyRing(settingsIn(EXAMPLE).LINK_KEYS ?? '')).toThrow(
      /64-character hex key/,
    );
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
    expect(parseKeyRing(env.LINK_KEYS).active.kid).toBe('k1');
  });

  it('starts the app off named after the project', () => {
    // It is the name in the logo row of every
    // email this app sends and in the headline of
    // every form it serves, so it is a real
    // setting rather than a slug — but the project
    // name is the only answer the scaffold has, and
    // a name nobody has changed beats no name.
    expect(settingsIn(ENV).APP_NAME).toBe('my_app');
  });

  it('gives every required variable a value that is really there', () => {
    const settings = settingsIn(ENV);

    for (const key of requiredKeys()) {
      expect(settings[key] ?? '').not.toBe('');
    }
  });

  it('requires exactly the nine an app cannot run without', () => {
    // Derived from the schema rather than listed
    // twice: a variable that quietly became
    // required would otherwise pass a list that
    // was written before it did.
    expect(requiredKeys()).toEqual([
      'APP_BASE_URL',
      'APP_NAME',
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

describe('the deploy command in the README', () => {
  it('sets exactly the variables the app cannot run without', () => {
    // The README section exists to stop a
    // deployment that comes up and dies naming
    // variables nobody was told to set. Derived
    // from the schema rather than listed, so a
    // variable that quietly becomes required fails
    // here instead of in somebody's first deploy.
    expect(setNamesIn(contentsOf('README.md'))).toEqual(requiredKeys());
  });
});

/** The variables the README's deploy block sets. */
function setNamesIn(text: string): string[] {
  return [...text.matchAll(/--set ([A-Z][A-Z0-9_]*)=/g)]
    .map((match) => match[1] ?? '')
    .sort();
}

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
