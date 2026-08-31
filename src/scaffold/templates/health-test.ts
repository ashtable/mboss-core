/**
 * The one test a new project ships with.
 *
 * It is emitted from here rather than copied out
 * of the mirrored runtime tree, because that copy
 * deliberately excludes every `*.test.ts`: a test
 * imports vitest, which the runtime has no
 * business dragging along. But `vitest run` with
 * no test files at all exits non-zero, so a
 * project with none would fail `npm test` on the
 * day it was created.
 *
 * The bytes below are compared against
 * `src/scaffold/app/health.test.ts`, which mBoss
 * runs in its own suite. That is what makes this
 * an example known to pass rather than an example
 * nobody has run.
 */
export const HEALTH_TEST_TS = `// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { describe, expect, it } from 'vitest';

import { healthPayload } from './health.js';

/**
 * The one test a new project ships with.
 *
 * It is here for two reasons. \`vitest run\` with no
 * test files at all exits non-zero, so \`npm test\`
 * would fail in a project nobody had written a
 * test for yet. And it is the shape to copy for
 * your own code-behind tests under \`lib/\`: import
 * the function, call it, assert on what came back.
 */

describe('the health payload', () => {
  it('says the app is serving', () => {
    expect(healthPayload()).toEqual({ ok: true });
  });
});
`;
