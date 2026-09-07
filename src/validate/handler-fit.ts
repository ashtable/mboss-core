import {
  TypeNameSchema,
  type NodeKind,
  type WorkflowNode,
} from '../ir/index.js';
import type { ExternalCall, LibFunction } from '../manifest/types.js';

/**
 * Whether a function from the project's code-behind
 * can sit behind a block.
 *
 * The picker in the Inspector, the drop target on a
 * node, and validation all have to give the same
 * answer — a function the picker offers and the
 * drop target refuses is a bug a person has no way
 * to explain — so there is one implementation and
 * they all call it.
 *
 * It reaches the IR and the manifest's shapes and
 * nothing else, because two of those three callers
 * run inside a webview bundle.
 */

/**
 * Why a function cannot sit behind a node.
 *
 * Codes rather than sentences, because the same
 * misfit is shown three ways: the picker greys a
 * row with a short note, a drop is refused with a
 * notification, and validation reports a
 * diagnostic. Each surface writes its own sentence
 * from the code; core writes only the diagnostic's.
 */
export type HandlerMisfit =
  | { kind: 'no-handler-kind' }
  /**
   * The call the scan found, with the file it was
   * found in — the whole call rather than a copy of
   * three of its fields, so that a field the scan
   * starts recording reaches every surface without
   * anyone having to notice.
   *
   * `via` is where the thing being called is
   * declared: a Node module under its `node:` name,
   * or `globalThis` for a global. A global's own
   * name is already the whole story, so a sentence
   * about one reads better without it — "calls
   * `fetch`", not "calls `fetch` from `globalThis`".
   */
  | ({ kind: 'external-call'; file: string } & ExternalCall)
  | { kind: 'too-many-params'; count: number }
  | { kind: 'input-mismatch'; declared: string; takes: string }
  | { kind: 'output-mismatch'; declared: string; returns: string }
  | { kind: 'not-a-decision'; returns: string };

export type HandlerFit =
  { fits: true } | { fits: false; reason: HandlerMisfit };

/**
 * The two misfits that are about a type somebody
 * wrote down, rather than about the shape of the
 * function or where it is being put.
 */
export type DeclaredTypeMisfit = Extract<
  HandlerMisfit,
  { kind: 'input-mismatch' } | { kind: 'output-mismatch' }
>;

/**
 * The kinds that run code of the author's.
 *
 * The other five start a run, repeat, wait, ask a
 * person or send mail, and the emitter drops a
 * handler on any of them — so naming a function
 * there is not an assignment to let through.
 */
export const HANDLER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'step',
  'transaction',
  'apiCall',
  'codeStep',
  'branch',
]);

/**
 * Whether the call to a block's handler hands it a
 * value.
 *
 * The emitter asks this to choose between
 * `handler()` and `handler(input)`. The check that
 * every way into a block carries the same value has
 * to ask it too: a block whose handler is handed
 * nothing cannot disagree with itself about what it
 * reads, and a block whose handler is handed
 * something reads a value whatever the document
 * says about its own input.
 *
 * Counted over every parameter rather than the
 * required ones — the opposite of the count in
 * `misfitOf` below, and deliberately so. That one
 * asks how many values a call cannot leave out;
 * this one asks whether the call hands over
 * anything at all. A handler declaring one optional
 * parameter is offered the value.
 *
 * `undefined` is a function the scan never found,
 * and reads as taking nothing: a block whose
 * handler is missing is refused on its own terms
 * before any value matters.
 */
export function consumesValue(fn: LibFunction | undefined): boolean {
  return (fn?.params.length ?? 0) > 0;
}

export function handlerFit(node: WorkflowNode, fn: LibFunction): HandlerFit {
  const reason = misfitOf(node, fn);

  return reason === undefined ? { fits: true } : { fits: false, reason };
}

/**
 * The first thing wrong with the pairing, or
 * `undefined` when the function fits.
 *
 * One reason rather than every reason: each caller
 * shows a person one sentence, and the first thing
 * wrong is the one to fix.
 */
function misfitOf(
  node: WorkflowNode,
  fn: LibFunction,
): HandlerMisfit | undefined {
  if (!HANDLER_KINDS.has(node.kind)) return { kind: 'no-handler-kind' };

  // A transaction's kind is a promise about what
  // its handler does: the body runs inside the
  // run's own database transaction, so what it
  // writes commits with the checkpoint or not at
  // all. A call to another system gets none of
  // that — it is not checkpointed, it is not
  // retried on a step's terms, and the rollback
  // does not undo it.
  //
  // Asked before anything about the signature
  // because the repair is a different one: those
  // are fixed by editing a declaration, this one
  // by making the block a step. It has to sit
  // above the fan-out exemption below, too, or a
  // transaction that fans out would be the one
  // shape never looked at.
  const called =
    node.kind === 'transaction' ? fn.externalCalls?.[0] : undefined;

  if (called !== undefined) {
    return { kind: 'external-call', file: fn.file, ...called };
  }

  // The emitter hands a handler at most one value,
  // so a second required parameter has nothing to
  // be given. An `(input, options?)` function is
  // called correctly with the one, which is why
  // this counts what the call cannot leave out
  // rather than what the signature declares.
  const required = fn.params.filter((param) => param.optional !== true);

  if (required.length > 1) {
    return { kind: 'too-many-params', count: required.length };
  }

  // A branch's handler is the logic: it runs as a
  // step and the cases test what it returns, so a
  // return type there has to be something a case
  // can name a value of.
  if (node.kind === 'branch' && decisionValues(fn) === undefined) {
    return { kind: 'not-a-decision', returns: fn.returnType };
  }

  return declaredTypeMisfit(node, fn);
}

/**
 * Where a block and the function behind it
 * disagree about a type one of them has written
 * down, or `undefined` where they do not.
 *
 * The tail of `misfitOf`, named because validation
 * needs this half on its own. `handlerFit` answers
 * with the first thing wrong, which is the right
 * answer for a picker greying one row — but two of
 * the things that come first are ones V13 does not
 * report, and an unreported reason used to hide a
 * reported one: a handler taking two values and
 * returning the wrong type was refused for the
 * arity, so the wrong type went unmentioned by
 * anybody.
 *
 * Kept here rather than copied into the rule.
 * There is one comparison and two questions asked
 * of it, which is the arrangement `handlerFit`
 * itself exists to keep.
 */
export function declaredTypeMisfit(
  node: WorkflowNode,
  fn: LibFunction,
): DeclaredTypeMisfit | undefined {
  // A declared type is a promise about code that
  // runs. On a kind that runs none there is
  // nothing to hold to it.
  if (!HANDLER_KINDS.has(node.kind)) return undefined;

  // A node that fans out takes the collection while
  // its handler takes one item of it, so the two
  // declarations are meant to differ. Without the
  // exemption every typed fan-out would be a
  // misfit and the picker would grey every
  // per-item handler.
  if (node.forEach !== undefined) return undefined;

  const takes = fn.params[0]?.type;

  if (
    node.in !== undefined &&
    takes !== undefined &&
    disagree(node.in, takes)
  ) {
    return { kind: 'input-mismatch', declared: node.in, takes };
  }

  // A branch's decision goes nowhere — nothing
  // downstream may read it, and the node declares
  // no `out` for it to disagree with.
  if (node.kind === 'branch') return undefined;

  if (node.out !== undefined && disagree(node.out, fn.returnType)) {
    return {
      kind: 'output-mismatch',
      declared: node.out,
      returns: fn.returnType,
    };
  }

  return undefined;
}

/**
 * Whether two type names contradict each other.
 *
 * Only plain names are compared. A generic, an
 * array or an inline object literal says something
 * a node's own declaration has no way to say back,
 * so comparing the text there would report a
 * disagreement that is only a difference in
 * notation.
 */
function disagree(declared: string, written: string): boolean {
  if (!TypeNameSchema.safeParse(written).success) return false;

  return declared !== written;
}

/**
 * The values a branch handler decides between, or
 * `undefined` when it decides nothing.
 *
 * The scan records them off the resolved type,
 * which is the only reader that can see through an
 * alias. The text is read only for a manifest an
 * older build cached, since `.mboss/manifest.json`
 * is keyed on the sources' hash rather than on the
 * build that wrote it.
 */
export function decisionValues(
  fn: LibFunction,
): readonly (string | boolean)[] | undefined {
  return fn.decision ?? decisionInText(fn.returnType);
}

/**
 * What a return type's text alone can say.
 *
 * Weaker than the type, and knowingly so: an alias
 * prints as it was written, so `Verdict` decides
 * nothing here and its branch stays greyed in the
 * picker until `lib/` next changes and a rescan
 * records what the name resolves to.
 */
function decisionInText(
  returnType: string,
): readonly (string | boolean)[] | undefined {
  if (returnType === 'boolean') return [true, false];

  const values: string[] = [];

  for (const member of returnType.split('|')) {
    const literal = stringLiteralIn(member.trim());

    if (literal === undefined) return undefined;

    values.push(literal);
  }

  return values;
}

/**
 * The text inside a string literal type, in either
 * quote style — a scan writes one and a person
 * editing the cache by hand may write the other.
 */
function stringLiteralIn(member: string): string | undefined {
  const quoted = /^'([^']*)'$/.exec(member) ?? /^"([^"]*)"$/.exec(member);

  return quoted?.[1];
}
