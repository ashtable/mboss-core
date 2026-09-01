import { describe, expect, it } from 'vitest';

import { constantTimeProblems } from './constant-time.js';

/**
 * The auditor, before anything trusts it.
 *
 * It is the only check on a property no assertion
 * about status codes can see, so the one thing it
 * must not do is pass everything. Each case below
 * is a way of losing the constant-time comparison
 * that a reader would otherwise have to catch by
 * eye.
 */

const GOOD = `
  import { timingSafeEqual } from 'node:crypto';

  function matches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented, 'utf8');
    const b = Buffer.from(expected, 'utf8');

    return a.length === b.length && timingSafeEqual(a, b);
  }
`;

describe('constantTimeProblems', () => {
  it('says nothing about a comparison written the right way', () => {
    // The length check is a `===`, and it is not
    // the one worth reporting: the length of a
    // secret is not the part being hidden.
    expect(constantTimeProblems(GOOD, 'matches')).toEqual([]);
  });

  it('reports a comparison rewritten as plain equality', () => {
    const source = `
      function matches(presented: string, expected: string): boolean {
        return presented === expected;
      }
    `;

    expect(constantTimeProblems(source, 'matches')).toEqual([
      'does not import timingSafeEqual from node:crypto',
      'matches() does not call timingSafeEqual',
      'matches() compares its two parameters directly',
    ]);
  });

  it('reports an early bail that leaves the call in place', () => {
    // The shortcut a later reader adds for speed.
    // It keeps every line the rule looks for and
    // gives away the answer before reaching them.
    const source = GOOD.replace(
      'const a =',
      'if (presented !== expected) return false;\n    const a =',
    );

    expect(constantTimeProblems(source, 'matches')).toEqual([
      'matches() compares its two parameters directly',
    ]);
  });

  it('reports a comparison that does not reach node:crypto at all', () => {
    // A local helper under the same name reads
    // like the real thing at the call site.
    const source = GOOD.replace(
      "import { timingSafeEqual } from 'node:crypto';",
      'const timingSafeEqual = (a: Buffer, b: Buffer) => a.equals(b);',
    );

    expect(constantTimeProblems(source, 'matches')).toEqual([
      'does not import timingSafeEqual from node:crypto',
    ]);
  });

  it('reports a call moved out of the function it was guarding', () => {
    const source = GOOD.replace(
      'return a.length === b.length && timingSafeEqual(a, b);',
      'return a.length === b.length && Buffer.compare(a, b) === 0;',
    );

    expect(constantTimeProblems(source, 'matches')).toEqual([
      'matches() does not call timingSafeEqual',
    ]);
  });

  it('reports a function that is not there under that name', () => {
    expect(constantTimeProblems(GOOD, 'compare')).toEqual([
      'declares no compare()',
    ]);
  });
});
