import type { NodeKind, WorkflowNode } from './catalog.js';
import type { Position, WorkflowEdge } from './types.js';
import type { WorkflowIR } from './workflow.js';

/**
 * The edits a workflow document takes: renaming a
 * node, deleting one, starting a new one,
 * rewriting a branch's cases for a handler that
 * decides, and carrying a person's layout across a
 * change.
 *
 * They are pure — a document in, the document it
 * should become out. Everything that makes an edit
 * durable, the lock and the revision and
 * validation and the atomic write, belongs to the
 * apply engine, and callers hand these results
 * straight to it. So the interesting part, which
 * is what counts as a reference to a node and when
 * a gap may be bridged, is testable without a
 * filesystem.
 *
 * The canvas now edits the document in every way
 * an agent does, and it does so from a webview
 * bundle. That is why this module reaches no
 * further than the IR, and why the two position
 * helpers take structural types instead of naming
 * the apply engine's.
 */

/**
 * A refusal carries a sentence rather than a code.
 * These are bad arguments — a node that is not
 * there, an id already taken — not the coded
 * failures an agent is expected to handle, and
 * inventing a code for them would put something on
 * the product's error surface that nothing agreed
 * to.
 */
type Refusal = { ok: false; message: string };

export type RenameRequest = {
  nodeId: string;
  newId?: string;
  newTitle?: string;
};

export type RenameOutcome =
  { ok: true; ir: WorkflowIR; updatedReferences: number } | Refusal;

export type DeleteRequest = { nodeId: string; reconnect: boolean };

export type DeleteOutcome =
  | {
      ok: true;
      ir: WorkflowIR;
      removedEdges: string[];
      bridgedEdge?: string;
    }
  | Refusal;

/**
 * Renames a node, or retitles it, or both.
 *
 * An id is not a label: it names the function the
 * compiler emits, and three other places in the
 * document point at it — the ends of an edge, the
 * members of a loop's body, and the email a form
 * wait is waiting on. All four move together here,
 * because a rename that moved only the node would
 * leave a document that no longer validates.
 *
 * `updatedReferences` counts the other three. The
 * node's own id is not a reference to itself, and
 * a caller that only changed a title has moved
 * nothing.
 */
export function renameNode(
  ir: WorkflowIR,
  request: RenameRequest,
): RenameOutcome {
  const { nodeId, newId, newTitle } = request;

  const target = ir.nodes.find((node) => node.id === nodeId);
  if (target === undefined) return missingNode(nodeId);

  if (newId === undefined && newTitle === undefined) {
    return {
      ok: false,
      message:
        `Nothing to change about \`${nodeId}\`. Give a new id, a ` +
        `new title, or both.`,
    };
  }

  if (newId !== undefined && newId !== nodeId) {
    if (ir.nodes.some((node) => node.id === newId)) {
      return {
        ok: false,
        message:
          `\`${newId}\` is already a node in this workflow. Ids ` +
          `name generated functions, so they have to be unique.`,
      };
    }
  }

  const to = newId ?? nodeId;
  let updatedReferences = 0;

  const nodes = ir.nodes.map((node) => {
    const renamed = renameReferencesIn(node, nodeId, to);
    updatedReferences += renamed.updated;

    return node.id === nodeId
      ? { ...renamed.node, id: to, title: newTitle ?? node.title }
      : renamed.node;
  });

  const edges = ir.edges.map((edge) => {
    if (to !== nodeId) {
      if (edge.from.node === nodeId) updatedReferences += 1;
      if (edge.to.node === nodeId) updatedReferences += 1;
    }

    return {
      ...edge,
      from: { ...edge.from, node: rename(edge.from.node, nodeId, to) },
      to: { ...edge.to, node: rename(edge.to.node, nodeId, to) },
    };
  });

  return { ok: true, ir: { ...ir, nodes, edges }, updatedReferences };
}

/**
 * Removes a node and everything wired to it.
 *
 * When the node sat in the middle of a straight
 * run, `reconnect` joins what was on either side
 * of it, so deleting a block out of a chain leaves
 * a chain rather than two halves.
 *
 * The one reference this does not chase is a form
 * wait naming the deleted email. That wait is now
 * waiting for something nobody will ever send, and
 * only its author can say what should happen
 * instead — so validation reports it and the apply
 * is refused, rather than this quietly rewriting
 * the wait into something no one asked for.
 */
export function deleteNode(
  ir: WorkflowIR,
  request: DeleteRequest,
): DeleteOutcome {
  const { nodeId, reconnect } = request;

  if (!ir.nodes.some((node) => node.id === nodeId)) {
    return missingNode(nodeId);
  }

  const touching = ir.edges.filter(
    (edge) => edge.from.node === nodeId || edge.to.node === nodeId,
  );
  const kept = ir.edges.filter((edge) => !touching.includes(edge));

  const bridge = reconnect ? bridgeFor(ir, nodeId, touching) : undefined;

  const nodes = ir.nodes
    .filter((node) => node.id !== nodeId)
    .map((node) => withoutBodyMember(node, nodeId));

  return {
    ok: true,
    ir: {
      ...ir,
      nodes,
      edges: bridge === undefined ? kept : [...kept, bridge],
    },
    removedEdges: touching.map((edge) => edge.id),
    ...(bridge === undefined ? {} : { bridgedEdge: bridge.id }),
  };
}

/**
 * The edge that closes the gap, if there is an
 * unambiguous one.
 *
 * Unambiguous means exactly one edge in and
 * exactly one edge out, neither of them a back
 * edge. With two edges in there is no telling
 * which run should now continue to the far side,
 * and a back edge closes a loop — bridging one
 * would silently rewire where that loop goes back
 * to.
 *
 * The new edge leaves the port the old one left
 * from and carries the type that already flowed
 * along it, because what reaches the far side is
 * still whatever the upstream node produces.
 */
function bridgeFor(
  ir: WorkflowIR,
  nodeId: string,
  touching: readonly WorkflowEdge[],
): WorkflowEdge | undefined {
  const inbound = touching.filter((edge) => edge.to.node === nodeId);
  const outbound = touching.filter((edge) => edge.from.node === nodeId);

  const [into] = inbound;
  const [outOf] = outbound;

  if (inbound.length !== 1 || outbound.length !== 1) return undefined;
  if (into === undefined || outOf === undefined) return undefined;
  if (into.back || outOf.back) return undefined;

  // A node wired to itself is one edge in and one
  // edge out, and bridging it would wire the far
  // side to the near side of nothing.
  if (into.from.node === nodeId || outOf.to.node === nodeId) return undefined;

  return {
    id: nextEdgeId(ir.edges),
    from: into.from,
    to: outOf.to,
    ...(into.type === undefined ? {} : { type: into.type }),
    back: false,
  };
}

/**
 * An id no edge in the document holds. Edge ids
 * are `e` and a number, so the next one is one
 * past the highest.
 */
export function nextEdgeId(edges: readonly WorkflowEdge[]): string {
  const used = edges.map((edge) => Number(edge.id.slice(1)));

  return `e${Math.max(0, ...used) + 1}`;
}

/**
 * The same node with every mention of an id
 * changed, and how many mentions that was.
 */
function renameReferencesIn(
  node: WorkflowNode,
  from: string,
  to: string,
): { node: WorkflowNode; updated: number } {
  if (from === to) return { node, updated: 0 };

  if (node.kind === 'loop') {
    const updated = node.config.body.filter((id) => id === from).length;
    if (updated === 0) return { node, updated };

    return {
      node: {
        ...node,
        config: {
          ...node.config,
          body: node.config.body.map((id) => rename(id, from, to)),
        },
      },
      updated,
    };
  }

  if (node.kind === 'durableWait') {
    const source = node.config.source;
    if (source.kind !== 'form' || source.email !== from) {
      return { node, updated: 0 };
    }

    return {
      node: {
        ...node,
        config: { ...node.config, source: { ...source, email: to } },
      },
      updated: 1,
    };
  }

  return { node, updated: 0 };
}

/**
 * The same node with a deleted id gone from its
 * loop body. A body lists the nodes a loop
 * repeats, and a node that no longer exists is not
 * one of them.
 */
function withoutBodyMember(node: WorkflowNode, nodeId: string): WorkflowNode {
  if (node.kind !== 'loop' || !node.config.body.includes(nodeId)) return node;

  return {
    ...node,
    config: {
      ...node.config,
      body: node.config.body.filter((id) => id !== nodeId),
    },
  };
}

function rename(id: string, from: string, to: string): string {
  return id === from ? to : id;
}

function missingNode(nodeId: string): Refusal {
  return {
    ok: false,
    message: `\`${nodeId}\` is not a node in this workflow.`,
  };
}

/**
 * The bound a branch case carries when nobody has
 * set one. These are the schema's own defaults,
 * written out because a case built here is a value
 * rather than something parsed — and a case that
 * originates no back edge never has either read.
 */
const CASE_BOUND = { maxIterations: 10, onExhausted: 'abort' } as const;

/**
 * A node of one kind carrying the smallest config
 * its schema accepts, for a block dropped on the
 * canvas before anybody has said what it does.
 *
 * Smallest, not valid: an approval dropped into a
 * workflow whose trigger names no requester is a
 * validation error until the Inspector fixes it,
 * and that is the right answer — the block is a
 * draft, and the rules say what is missing rather
 * than the parser refusing to hold it at all.
 */
export function starterNode(
  kind: NodeKind,
  id: string,
  title: string,
): WorkflowNode {
  const base = { id, title };

  switch (kind) {
    case 'trigger':
      return { ...base, kind, config: { mode: 'manual' } };

    case 'step':
    case 'transaction':
    case 'codeStep':
      return { ...base, kind, config: {} };

    case 'apiCall':
      return { ...base, kind, config: { service: '' } };

    case 'branch':
      return {
        ...base,
        kind,
        config: {
          cases: [
            { port: 'yes', when: { path: '', op: 'exists' }, ...CASE_BOUND },
          ],
          elsePort: 'else',
        },
      };

    case 'loop':
      return {
        ...base,
        kind,
        config: { minRounds: 1, maxRounds: 1, body: [] },
      };

    case 'durableWait':
      return {
        ...base,
        kind,
        config: {
          source: { kind: 'timer', seconds: 60 },
          onTimeout: 'abort',
        },
      };

    case 'approval':
      return { ...base, kind, config: { to: 'requestingUser' } };

    case 'emailSend':
      return {
        ...base,
        kind,
        config: {
          to: 'requestingUser',
          subject: '',
          bodyMarkdown: '',
          attach: { type: 'none' },
        },
      };
  }
}

/**
 * The first id of a kind the document does not
 * already hold: `step`, then `step_2`, `step_3`.
 *
 * An id is a lowercase slug — it names a generated
 * function — while a kind is written the way
 * TypeScript writes one, so `apiCall` starts at
 * `api_call`.
 */
export function starterId(ir: WorkflowIR, kind: NodeKind): string {
  const taken = new Set(ir.nodes.map((node) => node.id));
  const base = kind.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

  let id = base;
  let ordinal = 1;

  while (taken.has(id)) {
    ordinal += 1;
    id = `${base}_${ordinal}`;
  }

  return id;
}

type BranchNode = Extract<WorkflowNode, { kind: 'branch' }>;

/**
 * A branch's cases rewritten as one per decision
 * value, for a branch that has just been handed a
 * function that decides.
 *
 * Ports are taken in order from the cases already
 * there, then the old fall-through, then minted
 * from the value. Taking the fall-through second
 * is what saves the commonest branch there is: one
 * `yes` case and a `no` else, both wired. Ports
 * from the cases alone would give `true` the `yes`
 * port and mint a `false` port nothing is wired
 * to, leaving the `no` wire dangling — and a
 * canvas write does not pass through the apply
 * gate, so that error would reach the disk.
 *
 * `maxIterations` and `onExhausted` carry by
 * index, so a loop bound set on the first case
 * stays on the first case.
 */
export function withDecisionCases(
  node: BranchNode,
  values: readonly (string | boolean)[],
): BranchNode {
  const ports = [
    ...node.config.cases.map((branchCase) => branchCase.port),
    node.config.elsePort,
  ];
  const taken = new Set<string>();

  const cases = values.map((value, index) => {
    const port = ports[index] ?? freePort(String(value), taken);
    const bound = node.config.cases[index] ?? CASE_BOUND;
    taken.add(port);

    return {
      port,
      // A decision case tests the decision itself,
      // which is the value an empty path names.
      when: { path: '', op: 'eq' as const, value },
      maxIterations: bound.maxIterations,
      onExhausted: bound.onExhausted,
    };
  });

  return {
    ...node,
    config: { cases, elsePort: freePort('else', taken) },
  };
}

/**
 * `preferred`, or the first numbered spelling of
 * it nothing has taken. Every port on a branch has
 * to be its own, fall-through included: a port is
 * how an edge says which outcome it belongs to.
 */
function freePort(preferred: string, taken: ReadonlySet<string>): string {
  let port = preferred;
  let ordinal = 1;

  while (taken.has(port)) {
    ordinal += 1;
    port = `${preferred}_${ordinal}`;
  }

  return port;
}

/**
 * A document seen as nodes that may say where they
 * sit, which is all the two below need of one.
 *
 * Structural rather than `WorkflowIR`: the apply
 * engine carries positions onto a spec — a
 * document with its envelope omitted — and naming
 * that type would mean importing it from `apply/`,
 * which this module cannot reach.
 */
type Placeable = {
  nodes: readonly { id: string; position?: Position }[];
};

/**
 * `next` with every position `current` had that it
 * does not, matched by node id.
 *
 * Only where `next` is silent: a node that says
 * where it sits means it. This is what lets an
 * agent rewrite a workflow without knowing
 * coordinates exist and still leave the layout a
 * person arranged by hand.
 */
export function carryPositions<T extends Placeable>(
  current: Placeable | undefined,
  next: T,
): T {
  if (current === undefined) return next;

  const placed = new Map(current.nodes.map((node) => [node.id, node.position]));

  const nodes = next.nodes.map((node) => {
    const position = node.position ?? placed.get(node.id);

    return position === undefined ? node : { ...node, position };
  });

  // Asserted because "the same document, with the
  // same nodes, one property fuller" is not
  // something TypeScript can say about a type
  // parameter — and every caller wants its own
  // type back rather than this one.
  return { ...next, nodes } as T;
}

/**
 * The same document with no coordinates on it, for
 * anything asking what changed. A drag moved a
 * block; it did not edit the workflow, and a
 * summary that counted it as one would read
 * "12 nodes changed" for a proposal that touched
 * two.
 */
export function withoutPositions<T extends Placeable>(doc: T): T {
  // The coordinate is named only so the rest of
  // the node can be taken without it.
  const nodes = doc.nodes.map(({ position: _position, ...rest }) => rest);

  return { ...doc, nodes } as T;
}
