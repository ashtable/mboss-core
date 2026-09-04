import { describe, expect, it } from 'vitest';

import { sameGuard } from './guard.js';

describe('sameGuard', () => {
  const guard = { path: 'ok', op: 'eq', value: true } as const;

  it('calls two nodes with no condition equally guarded', () => {
    expect(sameGuard(undefined, undefined)).toBe(true);
  });

  it('calls a guarded node and an unguarded one different', () => {
    expect(sameGuard(guard, undefined)).toBe(false);
    expect(sameGuard(undefined, guard)).toBe(false);
  });

  it('compares the path, the operator and the value', () => {
    expect(sameGuard(guard, { ...guard })).toBe(true);
    expect(sameGuard(guard, { ...guard, value: false })).toBe(false);
    expect(sameGuard(guard, { ...guard, op: 'neq' })).toBe(false);
    expect(sameGuard(guard, { ...guard, path: 'other' })).toBe(false);
  });
});
