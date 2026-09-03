import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { constantTimeProblems } from '../../../test-support/constant-time.js';

import { requireSecret, type StartWorkflow } from './ports.js';

/**
 * `requireSecret` is the one gate every
 * workflow-starting route shares, so it has to
 * fail closed on its own, not by trusting that
 * whatever configured it already checked.
 */
describe('requireSecret', () => {
  it('refuses to guard anything with an empty secret', () => {
    // An empty header and an empty expected secret
    // compare equal, so a guard built from '' would
    // authorize every request that sends no header
    // at all. Refusing at construction turns that
    // into a boot failure instead of an open route.
    expect(() => requireSecret('')).toThrow();
  });
});

const PORTS = join(import.meta.dirname, 'ports.ts');

describe('the secret comparison', () => {
  it('is written in constant time', () => {
    // `matches` carries a long comment explaining
    // why an ordinary comparison would leak how
    // much of a guess was right, and until this
    // test nothing held it to that. The two are
    // behaviourally identical — the route tests,
    // including the deliberate right-length case,
    // pass either way — so the property is read
    // out of the source instead.
    const source = readFileSync(PORTS, 'utf8');

    expect(constantTimeProblems(source, 'matches')).toEqual([]);
  });
});

/**
 * Starting a run, as a route is handed it.
 *
 * Both routes answer with the id the run was filed
 * under, and when the caller named none only the
 * SDK knows it — so the id has to come back
 * through this port. A start that resolved to
 * nothing would leave a route with nothing to echo
 * and its caller with no name for the run it just
 * asked for.
 *
 * The assertion below is the type-check's rather
 * than vitest's: `tsc --noEmit` reads this file
 * and fails on a directive that found no error.
 */
describe('the start port', () => {
  it('does not accept a start that resolves to nothing', () => {
    // @ts-expect-error a start answers with an id.
    const resolvesToNothing: StartWorkflow = async (): Promise<void> => {};

    void resolvesToNothing;
  });
});
