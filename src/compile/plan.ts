import type { Predicate, WorkflowIR, WorkflowNode } from '../ir/index.js';
import { buildGraph } from '../validate/graph.js';
import { sameGuard } from '../validate/rules.js';

import { UnsupportedIR } from './unsupported.js';

/**
 * The order a workflow's blocks run in, and where
 * each one gets its input.
 *
 * Emission asks two questions of the graph — what
 * comes next, and whose value does this block
 * read — and both are answered here, once, before
 * a line is written. Answering them while writing
 * would mean a code emitter that also walks a
 * graph, which is how the order codegen produces
 * comes to differ from the order validation
 * checked.
 */

/** What the workflow is entered through. */
export type TriggerNode = Extract<WorkflowNode, { kind: 'trigger' }>;

/**
 * A maximal run of consecutive blocks carrying the
 * same condition.
 *
 * One `if` per run rather than one per block: a
 * value bound inside one `if` does not narrow
 * inside a second `if` testing the same thing, so
 * a chain emitted block by block would be rejected
 * at its own second block.
 */
export type GuardGroup = {
  guard: Predicate | undefined;
  nodes: readonly WorkflowNode[];
};

export type EmissionPlan = {
  trigger: TriggerNode;
  /**
   * Every block that runs, in the order it runs.
   *
   * Only what the trigger can reach: an island is
   * a legal draft, and emitting one would produce
   * references to values nothing assigns. The walk
   * refuses everything it cannot follow, so what
   * comes back here is either the whole reachable
   * graph or nothing at all.
   */
  chain: readonly WorkflowNode[];
  groups: readonly GuardGroup[];
  /** Which block's value each block reads. The
   *  trigger is a producer like any other. */
  producers: ReadonlyMap<string, string>;
};

/**
 * The kinds this compiler does not emit yet, and
 * what to say about each.
 *
 * Named rather than reported as "unsupported node"
 * so the message tells somebody looking at their
 * canvas which block to take out.
 */
const NOT_YET: Partial<Record<WorkflowNode['kind'], string>> = {
  branch: 'a branch',
  loop: 'a loop',
  durableWait: 'a wait',
  approval: 'an approval',
  emailSend: 'an email',
};

export function planWorkflow(ir: WorkflowIR): EmissionPlan {
  const graph = buildGraph(ir);
  const trigger = ir.nodes.find(
    (node): node is TriggerNode => node.kind === 'trigger',
  );

  if (trigger === undefined) {
    throw new UnsupportedIR('this workflow has no trigger, so it never runs.');
  }

  const chain: WorkflowNode[] = [];
  const producers = new Map<string, string>();
  const visited = new Set<string>([trigger.id]);

  let previous: WorkflowNode | TriggerNode = trigger;

  for (;;) {
    const outgoing = graph.outgoing.get(previous.id) ?? [];

    if (outgoing.length === 0) break;
    if (outgoing.length > 1) {
      throw new UnsupportedIR(
        `\`${previous.id}\` leaves by more than one wire, and this ` +
          `compiler only follows one.`,
        previous.id,
      );
    }

    const edge = outgoing[0];
    if (edge === undefined) break;

    if (edge.back) {
      throw new UnsupportedIR(
        `\`${previous.id}\` closes a loop, which this compiler does not ` +
          `emit yet.`,
        previous.id,
      );
    }

    const next = graph.nodes.get(edge.to.node);
    if (next === undefined) {
      throw new UnsupportedIR(
        `\`${previous.id}\` wires to \`${edge.to.node}\`, which is not a ` +
          `block in this workflow.`,
        previous.id,
      );
    }

    const notYet = NOT_YET[next.kind];
    if (notYet !== undefined) {
      throw new UnsupportedIR(
        `\`${next.id}\` is ${notYet}, which this compiler does not emit yet.`,
        next.id,
      );
    }

    if (visited.has(next.id)) {
      throw new UnsupportedIR(
        `\`${next.id}\` runs more than once, which this compiler does not ` +
          `emit yet.`,
        next.id,
      );
    }

    visited.add(next.id);
    producers.set(next.id, previous.id);
    chain.push(next);
    previous = next;
  }

  return { trigger, chain, groups: groupByGuard(chain), producers };
}

/**
 * Consecutive blocks sharing a condition, compared
 * the way validation compares them — so what the
 * compiler groups is what the rule about guarded
 * consumers already checked.
 */
function groupByGuard(chain: readonly WorkflowNode[]): GuardGroup[] {
  const groups: GuardGroup[] = [];

  for (const node of chain) {
    const last = groups.at(-1);

    if (last !== undefined && sameGuard(last.guard, node.guard)) {
      groups[groups.length - 1] = {
        guard: last.guard,
        nodes: [...last.nodes, node],
      };
      continue;
    }

    groups.push({ guard: node.guard, nodes: [node] });
  }

  return groups;
}
