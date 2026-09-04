import type { NodeKind, WorkflowNode } from './catalog.js';
import { buildGraph, dominators, topologicalOrder } from './graph.js';
import type { WorkflowIR } from './workflow.js';

/**
 * Which block bound the value a block reads.
 *
 * A wire says a value travels; it does not say
 * where the value came from. Between a producer
 * and the block that reads it there may be an
 * email, a wait, a branch — blocks that pass a
 * value along without binding one of their own —
 * so the answer is the nearest block above that
 * binds a value and that every path to the reader
 * goes through.
 *
 * Validation and the compiler both need it and
 * have to agree: the compiler names a local after
 * the block that bound it and refuses a document
 * where that local cannot be named, so a rule that
 * answered this differently would pass a document
 * the compiler then turned down.
 */

/**
 * The kinds that bind a value the blocks after
 * them can read.
 *
 * A branch decides where a run goes and produces
 * nothing, so a block after one reads whatever was
 * flowing when the branch was reached. An approval
 * is the same: what it binds is a decision, which
 * only the two ways out of it read, and the value
 * flowing past it is the one that arrived.
 */
const VALUE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'step',
  'codeStep',
  'apiCall',
  'transaction',
]);

/**
 * Whether a block binds a value of its own.
 *
 * A wait for a person or an event binds what
 * arrived; a wait on the clock binds nothing,
 * because nothing arrives.
 */
export function bindsValue(node: WorkflowNode | undefined): boolean {
  if (node === undefined) return false;

  if (node.kind === 'durableWait') {
    return node.config.source.kind !== 'timer';
  }

  return VALUE_KINDS.has(node.kind);
}

/**
 * For every block a run reaches, the block whose
 * value it reads.
 *
 * The nearest dominator that binds a value —
 * nearest by run order, so the last one a run
 * passes through before arriving. A dominator
 * because a value bound on one arm of a branch is
 * not there on the other, and the trigger as the
 * floor because the payload a run started with is
 * a value like any other.
 */
export function producers(ir: WorkflowIR): Map<string, string> {
  const found = new Map<string, string>();
  const trigger = ir.nodes.find((node) => node.kind === 'trigger');

  if (trigger === undefined) return found;

  const graph = buildGraph(ir);
  const order = topologicalOrder(graph, trigger.id);
  const doms = dominators(graph, trigger.id);

  const position = new Map<string, number>();
  order.forEach((id, index) => position.set(id, index));
  const at = (id: string): number => position.get(id) ?? 0;

  for (const id of order) {
    if (id === trigger.id) continue;

    const above = [...(doms.get(id) ?? new Set<string>())]
      .filter((other) => other !== id && bindsValue(graph.nodes.get(other)))
      .sort((a, b) => at(a) - at(b));

    found.set(id, above.at(-1) ?? trigger.id);
  }

  return found;
}
