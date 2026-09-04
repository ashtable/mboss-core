import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import {
  withoutPositions,
  type WorkflowEdge,
  type WorkflowNode,
} from '../ir/index.js';

/**
 * What changed between two versions of a workflow,
 * counted.
 *
 * This is the line a person reads before approving
 * an agent's edit — "3 nodes added, 1 changed" —
 * so it counts things a person recognises on a
 * canvas rather than JSON operations. It is a
 * schema and not a bare type because it is stored
 * in a proposal file and read back later.
 */
export const DiffSummarySchema = z.object({
  nodesAdded: z.number().int().min(0),
  nodesRemoved: z.number().int().min(0),
  nodesChanged: z.number().int().min(0),
  edgesAdded: z.number().int().min(0),
  edgesRemoved: z.number().int().min(0),
});

export type DiffSummary = z.infer<typeof DiffSummarySchema>;

/**
 * The part of a document a diff is taken over. A
 * full `WorkflowIR` satisfies it and so does a
 * spec, which is what lets a proposal be summarised
 * before it is ever a document.
 */
export type Diffable = {
  nodes: readonly WorkflowNode[];
  edges: readonly WorkflowEdge[];
};

/**
 * Summarises `prev` → `next`. `prev` is absent when
 * the workflow is being created, in which case
 * everything in it is new.
 *
 * Both sides are keyed by id, because an id is
 * what a node keeps across an edit — it names the
 * generated function. So a retitled or
 * reconfigured node is one change, not a removal
 * and an addition, and a document whose arrays
 * were merely reordered has no changes at all.
 *
 * There is no `edgesChanged`: an edge is little
 * more than its ends and its id, so a wire that
 * moved is a wire that went and a wire that came.
 *
 * Coordinates come off both sides first. Where a
 * block sits is a fact about a canvas rather than
 * about the workflow, so a drag is no change at
 * all, and an agent's spec written without
 * positions over a document that has them is not
 * every block in the workflow changed.
 */
export function diffSummary(
  prev: Diffable | undefined,
  next: Diffable,
): DiffSummary {
  const before = withoutPositions(prev ?? { nodes: [], edges: [] });
  const after = withoutPositions(next);

  const prevNodes = byId(before.nodes);
  const nextNodes = byId(after.nodes);
  const prevEdges = byId(before.edges);
  const nextEdges = byId(after.edges);

  let nodesChanged = 0;
  for (const [id, node] of nextNodes) {
    const before = prevNodes.get(id);

    if (before !== undefined && !isDeepStrictEqual(before, node)) {
      nodesChanged += 1;
    }
  }

  return {
    nodesAdded: missing(nextNodes, prevNodes),
    nodesRemoved: missing(prevNodes, nextNodes),
    nodesChanged,
    edgesAdded: missing(nextEdges, prevEdges),
    edgesRemoved: missing(prevEdges, nextEdges),
  };
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * How many of `from`'s ids the `against` side does
 * not have.
 */
function missing(
  from: ReadonlyMap<string, unknown>,
  against: ReadonlyMap<string, unknown>,
): number {
  let count = 0;

  for (const id of from.keys()) {
    if (!against.has(id)) count += 1;
  }

  return count;
}
