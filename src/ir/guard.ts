import type { Predicate } from './types.js';

/**
 * Whether two guards would gate a run the same
 * way.
 *
 * Structural rather than reference equality, and
 * shared rather than reimplemented: the rule that
 * flags a guarded producer feeding an unguarded
 * consumer compares guards this way, and the
 * compiler groups consecutive blocks and trusts a
 * value already in scope by the same comparison —
 * so what the compiler treats as "the same
 * condition" is exactly what validation already
 * checked.
 */
export function sameGuard(a?: Predicate, b?: Predicate): boolean {
  if (a === undefined || b === undefined) return a === b;

  return (
    a.path === b.path &&
    a.op === b.op &&
    JSON.stringify(a.value ?? null) === JSON.stringify(b.value ?? null)
  );
}
