import type { WorkflowNode } from './catalog.js';
import type { WorkflowEdge } from './types.js';
import type { WorkflowIR } from './workflow.js';

/**
 * The graph work validation and the compiler both
 * do over a document.
 *
 * Reachability, cycle detection, dominance,
 * topological order and join-finding are each
 * asked for more than once, over the same
 * adjacency — a validation rule builds it once for
 * three of its checks, and the compiler's planner
 * builds it once to decide execution order, value
 * scope and where a branch's arms come back
 * together. One implementation means the compiler
 * and the rule that checks a document's shape
 * agree about what that shape is.
 */

/**
 * A workflow's nodes indexed by id, with the edges
 * that leave and arrive at each.
 *
 * Edges are indexed under whatever node they name,
 * including a node that does not exist: a document
 * with a dangling edge still has to be walkable,
 * because the rule that reports it is only one of
 * eleven and the other ten still want an answer.
 * Every traversal here therefore steps only onto
 * ids that `nodes` actually holds.
 */
export type WorkflowGraph = {
  nodes: ReadonlyMap<string, WorkflowNode>;
  outgoing: ReadonlyMap<string, readonly WorkflowEdge[]>;
  incoming: ReadonlyMap<string, readonly WorkflowEdge[]>;
};

export function buildGraph(ir: WorkflowIR): WorkflowGraph {
  const nodes = new Map<string, WorkflowNode>();
  for (const node of ir.nodes) nodes.set(node.id, node);

  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const edge of ir.edges) {
    push(outgoing, edge.from.node, edge);
    push(incoming, edge.to.node, edge);
  }

  return { nodes, outgoing, incoming };
}

function push(
  index: Map<string, WorkflowEdge[]>,
  key: string,
  edge: WorkflowEdge,
): void {
  const existing = index.get(key);

  if (existing === undefined) index.set(key, [edge]);
  else existing.push(edge);
}

/**
 * Every node a run starting at `root` could get
 * to.
 *
 * Loop-closing edges count: they are edges the run
 * really takes, and a node reachable only around a
 * loop is still a node that executes.
 */
export function reachableFrom(graph: WorkflowGraph, root: string): Set<string> {
  return walk(graph, root, true);
}

/**
 * Whether the graph is acyclic once the
 * loop-closing edges are set aside.
 *
 * Those edges are the one legal way to draw a
 * cycle, and they are declared rather than
 * inferred, so what this asks is: is every cycle
 * in this document one the author meant?
 */
export function isDag(graph: WorkflowGraph): boolean {
  const remaining = new Map<string, number>();
  for (const id of graph.nodes.keys()) {
    remaining.set(id, forwardEdges(graph.incoming.get(id), graph).length);
  }

  const ready = [...remaining]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);

  let settled = 0;
  while (ready.length > 0) {
    const id = ready.pop();
    if (id === undefined) continue;

    settled += 1;

    for (const edge of forwardEdges(graph.outgoing.get(id), graph)) {
      const left = (remaining.get(edge.to.node) ?? 0) - 1;
      remaining.set(edge.to.node, left);
      if (left === 0) ready.push(edge.to.node);
    }
  }

  return settled === graph.nodes.size;
}

/**
 * For each node the root can reach, the nodes that
 * every path from the root to it passes through —
 * itself included.
 *
 * This is what makes a loop well defined: a
 * loop-closing edge may only target a dominator of
 * the branch that closes it, which is exactly the
 * condition under which the compiled `do/while`
 * re-enters at a point the run was always going to
 * be at.
 *
 * Computed over the forward graph alone. Letting a
 * loop-closing edge count as a way in would put
 * the branch that closes the loop between the
 * trigger and the node it loops back to, and no
 * back edge would ever be legal.
 */
export function dominators(
  graph: WorkflowGraph,
  root: string,
): Map<string, Set<string>> {
  const reachable = walk(graph, root, false);
  const all = [...reachable];

  const doms = new Map<string, Set<string>>();
  for (const id of all) {
    doms.set(id, id === root ? new Set([root]) : new Set(all));
  }

  // Standard fixpoint: a node is dominated by
  // itself plus whatever dominates all of its
  // predecessors. The sets only ever shrink, so
  // the loop terminates.
  let changed = true;
  while (changed) {
    changed = false;

    for (const id of all) {
      if (id === root) continue;

      const next = intersectPredecessors(graph, doms, reachable, id);
      next.add(id);

      if (!sameSet(next, doms.get(id))) {
        doms.set(id, next);
        changed = true;
      }
    }
  }

  return doms;
}

function intersectPredecessors(
  graph: WorkflowGraph,
  doms: ReadonlyMap<string, Set<string>>,
  reachable: ReadonlySet<string>,
  id: string,
): Set<string> {
  let result: Set<string> | undefined;

  for (const edge of forwardEdges(graph.incoming.get(id), graph)) {
    if (!reachable.has(edge.from.node)) continue;

    const predecessor = doms.get(edge.from.node);
    if (predecessor === undefined) continue;

    result =
      result === undefined
        ? new Set(predecessor)
        : new Set([...result].filter((each) => predecessor.has(each)));
  }

  return result ?? new Set<string>();
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string> | undefined) {
  return b !== undefined && a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * The edges of an index entry that both exist as a
 * forward step and land on nodes the document
 * declares.
 */
function forwardEdges(
  edges: readonly WorkflowEdge[] | undefined,
  graph: WorkflowGraph,
): readonly WorkflowEdge[] {
  return (edges ?? []).filter(
    (edge) =>
      !edge.back &&
      graph.nodes.has(edge.from.node) &&
      graph.nodes.has(edge.to.node),
  );
}

function walk(
  graph: WorkflowGraph,
  root: string,
  followBackEdges: boolean,
): Set<string> {
  const seen = new Set<string>();
  if (!graph.nodes.has(root)) return seen;

  const pending = [root];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);

    for (const edge of graph.outgoing.get(id) ?? []) {
      if (!followBackEdges && edge.back) continue;
      if (graph.nodes.has(edge.to.node)) pending.push(edge.to.node);
    }
  }

  return seen;
}

/**
 * Every node a run can reach from `root`, ordered
 * so that nothing appears before something a run
 * passes through to get to it.
 *
 * Loop-closing edges are set aside, the way they
 * are everywhere else here: they are what makes
 * the document cyclic, and an order is only
 * defined over the forward graph.
 *
 * Ties are broken by the order the document lists
 * its nodes in. Any order that respects the edges
 * is a correct one, and the one a person reading
 * their own canvas would expect is the one it was
 * drawn in.
 */
export function topologicalOrder(graph: WorkflowGraph, root: string): string[] {
  const reachable = walk(graph, root, false);
  const position = new Map<string, number>();
  for (const id of graph.nodes.keys()) position.set(id, position.size);

  const remaining = new Map<string, number>();
  for (const id of reachable) {
    remaining.set(
      id,
      forwardEdges(graph.incoming.get(id), graph).filter((edge) =>
        reachable.has(edge.from.node),
      ).length,
    );
  }

  const ready = [...remaining]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  const order: string[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));

    const id = ready.shift();
    if (id === undefined) continue;

    order.push(id);

    for (const edge of forwardEdges(graph.outgoing.get(id), graph)) {
      const left = (remaining.get(edge.to.node) ?? 0) - 1;
      remaining.set(edge.to.node, left);
      if (left === 0) ready.push(edge.to.node);
    }
  }

  return order;
}

/**
 * Where a branch's arms come back together: the
 * earliest node, in the order above, that two or
 * more of them reach.
 *
 * Deliberately not strict post-dominance. A branch
 * port with no edge at all ends the run, and
 * nothing post-dominates a branch that has one —
 * so a post-dominance rule would find no join and
 * force the whole tail of the workflow to be
 * duplicated into every arm, which would also
 * record the same step name twice.
 *
 * Arms that go nowhere contribute nothing, and a
 * loop-closing arm goes back rather than on.
 */
export function joinOf(
  graph: WorkflowGraph,
  branchId: string,
): string | undefined {
  const arms = forwardEdges(graph.outgoing.get(branchId), graph);
  const reaching = new Map<string, number>();

  for (const arm of arms) {
    for (const id of walk(graph, arm.to.node, false)) {
      reaching.set(id, (reaching.get(id) ?? 0) + 1);
    }
  }

  return topologicalOrder(graph, branchId).find(
    (id) => (reaching.get(id) ?? 0) > 1,
  );
}
