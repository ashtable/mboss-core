import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * Every module in the runtime, imported with
 * nothing running and nothing configured.
 *
 * This is what makes the rest possible. mBoss
 * type-checks generated code, lints it and imports
 * it to prove the workflows it wrote register; all
 * of that happens in a process with no database,
 * no credentials and no environment at all. A
 * module that read the environment at import, or
 * opened a connection, would fail every one of
 * those checks in a way that looked like a bug in
 * the check.
 *
 * `main.ts` is the exception, and the only one: it
 * exists to start the app, so importing it starts
 * the app. It is left out here on purpose and the
 * list below says so.
 */

const ROOT = import.meta.dirname;

function modulesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return name === '__snapshots__' ? [] : modulesUnder(path);
    }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) return [];

    return [path];
  });
}

const ALL = modulesUnder(ROOT).map((path) => ({
  path,
  rel: path.slice(ROOT.length + 1),
}));

const IMPORTABLE = ALL.filter((module) => module.rel !== 'main.ts');

const REAL_ENV = process.env;

afterEach(() => {
  process.env = REAL_ENV;
});

describe('the runtime tree', () => {
  it('is a real list, so a clean pass is not an empty one', () => {
    expect(IMPORTABLE.length).toBeGreaterThan(10);
    expect(IMPORTABLE.map((module) => module.rel)).toContain('db.ts');
    expect(IMPORTABLE.map((module) => module.rel)).toContain('mail.ts');
  });

  it('leaves out exactly one module, and it is the one that boots', () => {
    const left = ALL.filter((module) => !IMPORTABLE.includes(module));

    expect(left.map((module) => module.rel)).toEqual(['main.ts']);
  });
});

describe('with an empty environment', () => {
  it.each(IMPORTABLE.map((module) => module.rel))(
    '%s imports without a word',
    async (rel) => {
      process.env = {};
      const found = IMPORTABLE.find((module) => module.rel === rel);

      await expect(
        import(pathToFileURL(found?.path ?? '').href),
      ).resolves.toBeDefined();
    },
  );

  it('has built no database client on the way through', async () => {
    // The datasource is constructed at import —
    // it has to be, so that DBOS knows about it
    // before launch — but the client behind it is
    // not. If any of the imports above had built
    // one, it would have thrown on the missing
    // connection string, and asking for it here
    // would now succeed.
    process.env = {};
    const db = await import('./db.js');

    expect(() => db.prismaClient()).toThrow(/invalid environment/);
  });
});
