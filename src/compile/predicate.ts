import type { Predicate } from '../ir/index.js';

import { UnsupportedIR } from './unsupported.js';

/**
 * A condition from the IR, as a TypeScript
 * expression.
 *
 * A predicate names a value by dot-path and tests
 * it. Both halves are emitted here so that a
 * guard, a branch case and a form field's
 * condition all read the same value the same way —
 * three implementations of "what does `a.b.c`
 * mean" is three chances for the canvas to draw
 * one thing and the app to do another.
 */

/** What a dot-path segment is allowed to be. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The value a dot-path names, rooted at a binding
 * that is known to be there.
 *
 * Everything below the root is optional-chained.
 * The root is a local the workflow just bound, so
 * it exists; what hangs off it came out of a
 * payload somebody else sent, and reading through
 * a missing object is a crash rather than a false
 * condition.
 */
export function pathExpression(root: string, path: string): string {
  const segments = path.split('.');

  if (!segments.every((segment) => IDENTIFIER.test(segment))) {
    throw new UnsupportedIR(
      `\`${path}\` is not a path this compiler can read: it has to be ` +
        `field names separated by dots.`,
    );
  }

  return segments.reduce(
    (expression, segment, index) =>
      index === 0 ? `${expression}.${segment}` : `${expression}?.${segment}`,
    root,
  );
}

/**
 * The whole condition, as a boolean expression.
 *
 * `nonempty` is a length check, which is what
 * makes it mean the same thing for a string and
 * for a list. A value that has no length at all
 * fails the type-check gate, which is where a
 * condition asking a number whether it is empty
 * should fail.
 */
export function predicateExpression(
  root: string,
  predicate: Predicate,
): string {
  const value = pathExpression(root, predicate.path);

  switch (predicate.op) {
    case 'eq':
      return `${value} === ${literal(predicate.value)}`;

    case 'neq':
      return `${value} !== ${literal(predicate.value)}`;

    case 'gt':
      return `${value} > ${literal(predicate.value)}`;

    case 'gte':
      return `${value} >= ${literal(predicate.value)}`;

    case 'lt':
      return `${value} < ${literal(predicate.value)}`;

    case 'lte':
      return `${value} <= ${literal(predicate.value)}`;

    case 'exists':
      return `${value} !== undefined && ${value} !== null`;

    case 'nonempty':
      return `(${value}?.length ?? 0) > 0`;
  }
}

/**
 * A scalar as TypeScript source, quoted the way
 * prettier quotes it.
 *
 * Emitted code is checked for prettier-idempotence
 * — a double-quoted string would be rewritten on
 * the first format and the generated file would
 * stop matching itself.
 */
export function literal(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  switch (typeof value) {
    case 'string':
      return quote(value);

    case 'number':
    case 'boolean':
      return String(value);

    default:
      throw new UnsupportedIR(
        `a condition can only compare against one plain value, and this ` +
          `one compares against ${JSON.stringify(value)}.`,
      );
  }
}

function quote(text: string): string {
  const escaped = text
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');

  return `'${escaped}'`;
}
