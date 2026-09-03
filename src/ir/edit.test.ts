import { describe, expect, it } from 'vitest';

import { NodeKindSchema, NodeSchema, type WorkflowNode } from './catalog.js';
import {
  carryPositions,
  deleteNode,
  nextEdgeId,
  renameNode,
  starterId,
  starterNode,
  withDecisionCases,
  withoutPositions,
} from './edit.js';
import { WorkflowIRSchema, type WorkflowIR } from './workflow.js';

/**
 * A document built from a shorthand, so each test
 * shows only the part of the graph it is about.
 */
function workflow(parts: { nodes: unknown[]; edges: unknown[] }): WorkflowIR {
  return WorkflowIRSchema.parse({
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 1,
    name: 'sample',
    ...parts,
  });
}

function step(id: string): unknown {
  return { id, title: id, kind: 'step', config: {} };
}

/** A step that says where a person put it. */
function placedStep(id: string, x: number, y: number): unknown {
  return { id, title: id, kind: 'step', config: {}, position: { x, y } };
}

function edge(
  id: string,
  from: string,
  to: string,
  extra: object = {},
): unknown {
  return { id, from: { node: from }, to: { node: to }, ...extra };
}

/** A wait for the form a named email carries. */
function formWait(id: string, email: string): unknown {
  return {
    id,
    title: id,
    kind: 'durableWait',
    config: { source: { kind: 'form', email }, onTimeout: 'abort' },
  };
}

function loop(id: string, body: string[]): unknown {
  return {
    id,
    title: id,
    kind: 'loop',
    config: { minRounds: 1, maxRounds: 3, body },
  };
}

/** The renamed document, or a failure the test did not expect. */
function renamed(
  ir: WorkflowIR,
  request: { nodeId: string; newId?: string; newTitle?: string },
): { ir: WorkflowIR; updatedReferences: number } {
  const outcome = renameNode(ir, request);
  if (!outcome.ok) throw new Error(outcome.message);

  return outcome;
}

describe('renameNode', () => {
  it('rewrites edge endpoints', () => {
    const ir = workflow({
      nodes: [step('a'), step('b'), step('c')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    });

    const outcome = renamed(ir, { nodeId: 'b', newId: 'middle' });

    expect(outcome.ir.edges[0]?.to.node).toBe('middle');
    expect(outcome.ir.edges[1]?.from.node).toBe('middle');
    expect(outcome.ir.nodes.map((node) => node.id)).toEqual([
      'a',
      'middle',
      'c',
    ]);
  });

  it('rewrites a durableWait form source that names the node', () => {
    const ir = workflow({
      nodes: [step('send_form'), formWait('wait_reply', 'send_form')],
      edges: [edge('e1', 'send_form', 'wait_reply')],
    });

    const outcome = renamed(ir, { nodeId: 'send_form', newId: 'ask' });

    const wait = outcome.ir.nodes[1];
    if (wait?.kind !== 'durableWait') throw new Error('expected a wait');
    if (wait.config.source.kind !== 'form') throw new Error('expected a form');

    expect(wait.config.source.email).toBe('ask');
  });

  it('rewrites loop-body references', () => {
    const ir = workflow({
      nodes: [
        step('draft'),
        step('review'),
        loop('round', ['draft', 'review']),
      ],
      edges: [edge('e1', 'draft', 'review')],
    });

    const outcome = renamed(ir, { nodeId: 'draft', newId: 'write' });

    const round = outcome.ir.nodes[2];
    if (round?.kind !== 'loop') throw new Error('expected a loop');

    expect(round.config.body).toEqual(['write', 'review']);
  });

  it('counts every reference it updated', () => {
    const ir = workflow({
      nodes: [
        step('a'),
        step('send_form'),
        formWait('wait_reply', 'send_form'),
        loop('round', ['send_form', 'wait_reply']),
      ],
      edges: [
        edge('e1', 'a', 'send_form'),
        edge('e2', 'send_form', 'wait_reply'),
      ],
    });

    const outcome = renamed(ir, { nodeId: 'send_form', newId: 'ask' });

    // Two edge endpoints, one loop-body entry and
    // the wait's form source.
    expect(outcome.updatedReferences).toBe(4);
  });

  it('changes only the title when newId is absent', () => {
    const ir = workflow({
      nodes: [step('a'), step('b')],
      edges: [edge('e1', 'a', 'b')],
    });

    const outcome = renamed(ir, { nodeId: 'b', newTitle: 'Second thing' });

    expect(outcome.ir.nodes[1]?.id).toBe('b');
    expect(outcome.ir.nodes[1]?.title).toBe('Second thing');
    expect(outcome.updatedReferences).toBe(0);
  });

  it('refuses an id that already exists', () => {
    const ir = workflow({
      nodes: [step('a'), step('b')],
      edges: [edge('e1', 'a', 'b')],
    });

    const outcome = renameNode(ir, { nodeId: 'b', newId: 'a' });

    expect(outcome).toEqual({
      ok: false,
      message: expect.stringContaining('a'),
    });
  });

  it('refuses a node that is not in the workflow', () => {
    const ir = workflow({ nodes: [step('a')], edges: [] });

    const outcome = renameNode(ir, { nodeId: 'nope', newId: 'b' });

    expect(outcome.ok).toBe(false);
  });

  it('refuses a call that changes nothing', () => {
    const ir = workflow({ nodes: [step('a')], edges: [] });

    const outcome = renameNode(ir, { nodeId: 'a' });

    expect(outcome.ok).toBe(false);
  });
});

/** The edited document, or a failure the test did not expect. */
function deleted(
  ir: WorkflowIR,
  request: { nodeId: string; reconnect: boolean },
): { ir: WorkflowIR; removedEdges: string[]; bridgedEdge?: string } {
  const outcome = deleteNode(ir, request);
  if (!outcome.ok) throw new Error(outcome.message);

  return outcome;
}

describe('deleteNode', () => {
  it('removes the node and every edge touching it', () => {
    const ir = workflow({
      nodes: [step('a'), step('b'), step('c')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'a', 'c')],
    });

    const outcome = deleted(ir, { nodeId: 'b', reconnect: false });

    expect(outcome.ir.nodes.map((node) => node.id)).toEqual(['a', 'c']);
    expect(outcome.removedEdges).toEqual(['e1', 'e2']);
    expect(outcome.ir.edges.map((found) => found.id)).toEqual(['e3']);
  });

  it('bridges one upstream to one downstream edge', () => {
    const ir = workflow({
      nodes: [step('a'), step('b'), step('c')],
      edges: [edge('e1', 'a', 'b', { type: 'Booking' }), edge('e2', 'b', 'c')],
    });

    const outcome = deleted(ir, { nodeId: 'b', reconnect: true });

    expect(outcome.bridgedEdge).toBe('e3');
    expect(outcome.ir.edges).toEqual([
      {
        id: 'e3',
        from: { node: 'a', port: 'out' },
        to: { node: 'c' },
        type: 'Booking',
        back: false,
      },
    ]);
  });

  it('does not bridge when two upstream edges exist', () => {
    const ir = workflow({
      nodes: [step('a'), step('b'), step('c'), step('d')],
      edges: [edge('e1', 'a', 'c'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')],
    });

    const outcome = deleted(ir, { nodeId: 'c', reconnect: true });

    expect(outcome.bridgedEdge).toBeUndefined();
    expect(outcome.ir.edges).toEqual([]);
  });

  it('does not bridge across a back edge', () => {
    const ir = workflow({
      nodes: [step('a'), step('b')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a', { back: true })],
    });

    const outcome = deleted(ir, { nodeId: 'b', reconnect: true });

    expect(outcome.bridgedEdge).toBeUndefined();
    expect(outcome.removedEdges).toEqual(['e1', 'e2']);
  });

  it('does not bridge when reconnect is false', () => {
    const ir = workflow({
      nodes: [step('a'), step('b'), step('c')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    });

    const outcome = deleted(ir, { nodeId: 'b', reconnect: false });

    expect(outcome.bridgedEdge).toBeUndefined();
    expect(outcome.ir.edges).toEqual([]);
  });

  it('drops the node from a loop body', () => {
    const ir = workflow({
      nodes: [
        step('draft'),
        step('review'),
        step('publish'),
        loop('round', ['draft', 'review']),
      ],
      edges: [edge('e1', 'draft', 'review'), edge('e2', 'review', 'publish')],
    });

    const outcome = deleted(ir, { nodeId: 'review', reconnect: true });

    const round = outcome.ir.nodes.at(-1);
    if (round?.kind !== 'loop') throw new Error('expected a loop');

    expect(round.config.body).toEqual(['draft']);
  });

  it('refuses a node that is not in the workflow', () => {
    const ir = workflow({ nodes: [step('a')], edges: [] });

    const outcome = deleteNode(ir, { nodeId: 'nope', reconnect: true });

    expect(outcome.ok).toBe(false);
  });
});

describe('nextEdgeId', () => {
  it('starts at e1 when nothing is wired', () => {
    expect(nextEdgeId([])).toBe('e1');
  });

  it('goes one past the highest, not one past the count', () => {
    const ir = workflow({
      nodes: [step('a'), step('b')],
      edges: [edge('e2', 'a', 'b')],
    });

    expect(nextEdgeId(ir.edges)).toBe('e3');
  });
});

describe('starterNode', () => {
  it.each(NodeKindSchema.options)(
    'makes a %s the schema accepts as it stands',
    (kind) => {
      const node = starterNode(kind, 'block', 'Block');

      // Equal rather than merely parsing: a starter
      // the parser had to fill in would reach the
      // canvas missing whatever it filled.
      expect(NodeSchema.parse(node)).toEqual(node);
    },
  );

  it('carries the id and title it was given', () => {
    const node = starterNode('apiCall', 'fetch_rates', 'API call');

    expect(node).toMatchObject({ id: 'fetch_rates', title: 'API call' });
  });
});

describe('starterId', () => {
  it('numbers from the second one', () => {
    expect(starterId(workflow({ nodes: [], edges: [] }), 'step')).toBe('step');

    const ir = workflow({
      nodes: [step('step'), step('step_2')],
      edges: [],
    });

    expect(starterId(ir, 'step')).toBe('step_3');
  });

  it('spells a kind the way an id is allowed to be spelled', () => {
    const ir = workflow({ nodes: [], edges: [] });

    expect(starterId(ir, 'apiCall')).toBe('api_call');
  });
});

type BranchNode = Extract<WorkflowNode, { kind: 'branch' }>;

/**
 * A parsed branch, so the helper is handed the
 * shape a document holds rather than a literal.
 */
function branchNode(config: unknown): BranchNode {
  const node = NodeSchema.parse({
    id: 'decide',
    title: 'Decide',
    kind: 'branch',
    config,
  });
  if (node.kind !== 'branch') throw new Error('expected a branch');

  return node;
}

describe('withDecisionCases', () => {
  it('keeps both wires of a yes case and a no fall-through', () => {
    const node = branchNode({
      cases: [{ port: 'yes', when: { path: 'ok', op: 'eq', value: true } }],
      elsePort: 'no',
    });

    const decided = withDecisionCases(node, [true, false]);

    expect(
      decided.config.cases.map((branchCase) => [
        branchCase.port,
        branchCase.when,
      ]),
    ).toEqual([
      ['yes', { path: '', op: 'eq', value: true }],
      ['no', { path: '', op: 'eq', value: false }],
    ]);
    expect(decided.config.elsePort).toBe('else');
  });

  it('carries a loop bound by index', () => {
    const node = branchNode({
      cases: [
        {
          port: 'again',
          when: { path: 'done', op: 'eq', value: false },
          maxIterations: 4,
          onExhausted: 'continue',
        },
        { port: 'done', when: { path: 'done', op: 'eq', value: true } },
      ],
      elsePort: 'else',
    });

    const decided = withDecisionCases(node, [false, true]);

    expect(decided.config.cases[0]).toMatchObject({
      port: 'again',
      maxIterations: 4,
      onExhausted: 'continue',
    });
    expect(decided.config.cases[1]).toMatchObject({
      port: 'done',
      maxIterations: 10,
      onExhausted: 'abort',
    });
  });

  it('mints a port for a value nothing is wired to', () => {
    const node = branchNode({
      cases: [{ port: 'yes', when: { path: 'ok', op: 'exists' } }],
      elsePort: 'else',
    });

    const decided = withDecisionCases(node, ['low', 'medium', 'high']);

    // The fall-through's old name is now a case's,
    // so the fall-through takes the next one.
    expect(decided.config.cases.map((branchCase) => branchCase.port)).toEqual([
      'yes',
      'else',
      'high',
    ]);
    expect(decided.config.elsePort).toBe('else_2');
    // Distinct ports are what the schema refuses a
    // branch for, and a canvas write does not go
    // through the apply gate.
    expect(NodeSchema.parse(decided)).toEqual(decided);
  });
});

describe('carryPositions', () => {
  it('fills only the positions the next document lacks', () => {
    const current = workflow({
      nodes: [placedStep('a', 10, 20), placedStep('b', 30, 40)],
      edges: [],
    });

    const next = {
      nodes: [
        { id: 'a', title: 'a', kind: 'step', config: {} },
        {
          id: 'b',
          title: 'b',
          kind: 'step',
          config: {},
          position: { x: 99, y: 99 },
        },
        { id: 'c', title: 'c', kind: 'step', config: {} },
      ],
      edges: [],
    };

    expect(carryPositions(current, next).nodes).toEqual([
      {
        id: 'a',
        title: 'a',
        kind: 'step',
        config: {},
        position: { x: 10, y: 20 },
      },
      {
        id: 'b',
        title: 'b',
        kind: 'step',
        config: {},
        position: { x: 99, y: 99 },
      },
      { id: 'c', title: 'c', kind: 'step', config: {} },
    ]);
  });

  it('has nothing to carry from a workflow that does not exist yet', () => {
    const next = {
      nodes: [{ id: 'a', title: 'a', kind: 'step', config: {} }],
      edges: [],
    };

    expect(carryPositions(undefined, next)).toEqual(next);
  });
});

describe('withoutPositions', () => {
  it('strips every position and leaves the document alone', () => {
    const ir = workflow({
      nodes: [placedStep('a', 10, 20), step('b')],
      edges: [edge('e1', 'a', 'b')],
    });

    const bare = withoutPositions(ir);

    expect(bare.nodes).toEqual([
      { id: 'a', title: 'a', kind: 'step', config: {} },
      { id: 'b', title: 'b', kind: 'step', config: {} },
    ]);
    expect(bare.edges).toEqual(ir.edges);
    expect(ir.nodes[0]?.position).toEqual({ x: 10, y: 20 });
  });
});
