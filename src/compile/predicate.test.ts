import { describe, expect, it } from 'vitest';

import { PredicateSchema, type Predicate } from '../ir/index.js';

import { literal, pathExpression, predicateExpression } from './predicate.js';
import { UnsupportedIR } from './unsupported.js';

function predicate(parts: {
  path: string;
  op: Predicate['op'];
  value?: unknown;
}): Predicate {
  return PredicateSchema.parse(parts);
}

describe('pathExpression', () => {
  it('reads a single field off the root binding', () => {
    expect(pathExpression('evt', 'requestId')).toBe('evt.requestId');
  });

  it('chains optionally below the root, never on it', () => {
    // The root is the local the value was just
    // bound to, so it is there. Everything under
    // it came out of a payload somebody else sent.
    expect(pathExpression('evt', 'customer.email')).toBe('evt.customer?.email');
    expect(pathExpression('evt', 'a.b.c')).toBe('evt.a?.b?.c');
  });

  it('refuses a path that is not a series of identifiers', () => {
    expect(() => pathExpression('evt', 'items[0]')).toThrow(UnsupportedIR);
    expect(() => pathExpression('evt', 'a..b')).toThrow(UnsupportedIR);
    expect(() => pathExpression('evt', '')).toThrow(UnsupportedIR);
    expect(() => pathExpression('evt', '2fast')).toThrow(UnsupportedIR);
  });

  it('says what it could not compile', () => {
    expect(() => pathExpression('evt', 'items[0]')).toThrow(/items\[0\]/);
  });
});

describe('predicateExpression', () => {
  it('compiles every operator the catalog has', () => {
    const cases: [Predicate, string][] = [
      [
        predicate({ path: 'requestedSlotFree', op: 'eq', value: true }),
        'gridOut.requestedSlotFree === true',
      ],
      [
        predicate({ path: 'intent', op: 'neq', value: 'cancel' }),
        "gridOut.intent !== 'cancel'",
      ],
      [predicate({ path: 'total', op: 'gt', value: 10 }), 'gridOut.total > 10'],
      [
        predicate({ path: 'total', op: 'gte', value: 10 }),
        'gridOut.total >= 10',
      ],
      [predicate({ path: 'total', op: 'lt', value: 10 }), 'gridOut.total < 10'],
      [
        predicate({ path: 'total', op: 'lte', value: 10 }),
        'gridOut.total <= 10',
      ],
      [
        predicate({ path: 'customer.email', op: 'exists' }),
        'gridOut.customer?.email !== undefined && ' +
          'gridOut.customer?.email !== null',
      ],
      [
        predicate({ path: 'alternatives', op: 'nonempty' }),
        '(gridOut.alternatives?.length ?? 0) > 0',
      ],
    ];

    for (const [input, expected] of cases) {
      expect(predicateExpression('gridOut', input)).toBe(expected);
    }
  });

  it('refuses a comparison against something that is not one value', () => {
    expect(() =>
      predicateExpression(
        'gridOut',
        predicate({ path: 'a', op: 'eq', value: { b: 1 } }),
      ),
    ).toThrow(UnsupportedIR);
  });
});

describe('literal', () => {
  it('writes strings the way prettier would', () => {
    // The emitted file has to survive a
    // prettier-idempotence check, and prettier
    // rewrites a double-quoted string.
    expect(literal('book')).toBe("'book'");
    expect(literal("it's")).toBe("'it\\'s'");
    expect(literal('a\\b')).toBe("'a\\\\b'");
    expect(literal('a\nb')).toBe("'a\\nb'");
  });

  it('writes the other scalars as themselves', () => {
    expect(literal(1)).toBe('1');
    expect(literal(true)).toBe('true');
    expect(literal(null)).toBe('null');
    expect(literal(undefined)).toBe('undefined');
  });
});
