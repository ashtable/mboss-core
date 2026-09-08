/**
 * The two shapes a queue is described by, held
 * equal. `tsc --noEmit` (part of `npm run lint`)
 * is the assertion.
 *
 * A queue is described twice on purpose. The
 * compiler builds its entries from the IR and may
 * not read the scaffold; the runtime declares its
 * own in a file that imports nothing, so that a
 * generated project type-checks without this
 * library anywhere near it. Nothing else compares
 * the two, and a limit added to one side alone
 * would first be noticed as a type error inside a
 * generated registry that nobody wrote.
 */
import type { QueueEntry as Compiled } from '../compile/compile.js';

import type { QueueEntry as Declared } from './app/contract.js';

/** Each side, standing in for the other. */
const asDeclared: Declared = {} as Compiled;
const asCompiled: Compiled = {} as Declared;

/**
 * And every field name, in both directions.
 *
 * The assignments above are not enough on their
 * own. An object carrying an extra *optional*
 * member stays assignable both ways, and every
 * option here is optional — so a limit added to
 * one side would pass. A key union has no such
 * give, and the failure names the key.
 */
const entryFields: keyof Compiled = '' as keyof Declared;
const compiledEntryFields: keyof Declared = '' as keyof Compiled;

type DeclaredOptions = keyof Declared['options'];
type CompiledOptions = keyof Compiled['options'];

const optionFields: CompiledOptions = '' as DeclaredOptions;
const compiledOptionFields: DeclaredOptions = '' as CompiledOptions;

type DeclaredRateLimit = NonNullable<Declared['options']['rateLimit']>;
type CompiledRateLimit = NonNullable<Compiled['options']['rateLimit']>;

const rateLimitFields: keyof CompiledRateLimit = '' as keyof DeclaredRateLimit;
const compiledRateLimitFields: keyof DeclaredRateLimit =
  '' as keyof CompiledRateLimit;

// @ts-expect-error the unions above are the field
// names themselves rather than `string`, which is
// what stops the four assignments being vacuous
const strayField: DeclaredOptions = 'partitionDepth';

export type {};
void [
  asDeclared,
  asCompiled,
  entryFields,
  compiledEntryFields,
  optionFields,
  compiledOptionFields,
  rateLimitFields,
  compiledRateLimitFields,
  strayField,
];
