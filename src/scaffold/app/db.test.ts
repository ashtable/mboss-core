import { afterEach, describe, expect, it } from 'vitest';

import { appDb, prismaClient } from './db.js';

/**
 * The database seam, and the one property of it
 * that is easy to lose.
 *
 * Importing this module registers a datasource
 * with DBOS — that has to happen before launch, so
 * it happens at import — but it must not open a
 * connection or even read the environment. A
 * module that connected on import could not be
 * imported by a test, by a lint, or by the
 * smoke-import mBoss runs over generated code.
 *
 * Nothing here needs a database, and that is the
 * point of it.
 */

const REAL = process.env;

afterEach(() => {
  process.env = REAL;
});

describe('the datasource', () => {
  it('registers under the name the transactions name', () => {
    expect(appDb.name).toBe('app-db');
  });
});

describe('the client behind it', () => {
  it('reads the environment when it is called, and not before', () => {
    // The import above already happened with
    // whatever environment this test process has.
    // If it were read at import, or the client
    // built there, this file would have thrown on
    // its first line rather than reaching here.
    process.env = {};

    expect(() => prismaClient()).toThrow(/invalid environment/);
  });
});
