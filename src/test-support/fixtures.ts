import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { expect } from 'vitest';

/**
 * Helpers for the fixture and golden files under
 * `fixtures/`.
 *
 * They live outside `src/` deliberately: one
 * fixture is a code-behind directory with a real
 * type error in it, and the goldens are compared
 * byte for byte, so neither may be reached by
 * `tsc`, eslint, or prettier.
 *
 * This module is imported only by tests, but it
 * is not a `*.test.ts` — vitest would then try to
 * run it as a suite with no tests in it.
 */

/**
 * The one place the fixture tree's location is
 * written down. Every path below is relative to
 * it, so a fixture move is a one-line change.
 */
export const fixturesRoot = resolve(import.meta.dirname, '../../fixtures');

/**
 * Reads a fixture as text. `rel` is relative to
 * `fixtures/`, e.g. `ir/empty_draft.workflow.json`.
 */
export function readFixture(rel: string): string {
  return readFileSync(join(fixturesRoot, rel), 'utf8');
}

/**
 * Reads a JSON fixture. The result is `unknown`
 * in practice — the caller names the type it
 * expects and is responsible for parsing it with
 * a schema if it wants that guarantee.
 */
export function readFixtureJson<T>(rel: string): T {
  return JSON.parse(readFixture(rel)) as T;
}

/**
 * Compares `actual` against a blessed golden.
 *
 * With `UPDATE_GOLDENS=1` the golden is rewritten
 * and the test still fails: a blessing run must
 * never be mistakable for a passing run, or a
 * wrong output silently becomes the new
 * definition of right.
 */
export function expectGolden(rel: string, actual: string): void {
  const path = join(fixturesRoot, rel);

  if (process.env.UPDATE_GOLDENS === '1') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual, 'utf8');
    throw new Error(
      `rewrote the golden ${rel}. Read the diff, then re-run ` +
        `without UPDATE_GOLDENS=1 to confirm it passes.`,
    );
  }

  expect(actual).toBe(readFixture(rel));
}

/**
 * Every JSON golden goes through this, so a
 * reordered object key can never be the reason a
 * golden diff appears.
 *
 * Keys sort by code unit rather than by locale —
 * a golden is compared on whichever machine runs
 * CI, and `localeCompare` is not the same
 * everywhere.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}
