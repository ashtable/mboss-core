import { describe, expect, it } from 'vitest';

import type { WorkflowIR } from '../ir/index.js';
import type { LibManifest } from '../manifest/index.js';
import { makeIR, type NodeSpec } from '../test-support/ir.js';

import type { Diagnostic } from './diagnostic.js';
import { buildGraph } from './graph.js';
import {
  v01TriggerShape,
  v02Structure,
  v03Reachability,
  v04Acyclicity,
  v05BackEdges,
  v06EdgeTypes,
  v07Handlers,
  v08LoopBodies,
  v09FormWaits,
  v10GuardedConsumers,
  v11RequesterAddress,
  type RuleContext,
} from './rules.js';

function check(
  rule: (ctx: RuleContext) => Diagnostic[],
  ir: WorkflowIR,
  manifest?: LibManifest,
): Diagnostic[] {
  return rule({ ir, graph: buildGraph(ir), manifest });
}

function codes(found: readonly Diagnostic[]): string[] {
  return found.map((diagnostic) => diagnostic.code);
}

const EVENT_TRIGGER: NodeSpec = {
  id: 'start',
  kind: 'trigger',
  config: {
    mode: 'event',
    topic: 'booking.requested',
    requesterEmailPath: 'customer.email',
  },
};

const YES_NO_BRANCH: NodeSpec = {
  id: 'decide',
  kind: 'branch',
  config: {
    cases: [{ port: 'yes', when: { path: 'ok', op: 'eq', value: true } }],
    elsePort: 'no',
  },
};

function manifestWith(parts: Partial<LibManifest>): LibManifest {
  return {
    scannedAt: '2026-01-01T00:00:00.000Z',
    sourceHash: 'test',
    functions: [],
    types: [],
    typeSources: {},
    errors: [],
    ...parts,
  };
}

describe('V01 trigger shape', () => {
  it('accepts one trigger with nothing pointing at it', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'work' }],
      edges: [{ from: 'start', to: 'work' }],
    });

    expect(check(v01TriggerShape, ir)).toEqual([]);
  });

  it('warns, and only warns, when the draft has no trigger yet', () => {
    const ir = makeIR({ nodes: [{ id: 'work' }] });
    const found = check(v01TriggerShape, ir);

    expect(codes(found)).toEqual(['V01']);
    expect(found[0]?.severity).toBe('warning');
  });

  it('rejects a second trigger', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { ...EVENT_TRIGGER, id: 'other_start' }],
    });
    const found = check(v01TriggerShape, ir);

    expect(codes(found)).toEqual(['V01']);
    expect(found[0]?.severity).toBe('error');
    expect(found[0]?.nodeId).toBe('other_start');
  });

  it('rejects an edge into the trigger', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'work' }],
      edges: [
        { from: 'start', to: 'work' },
        { id: 'e2', from: 'work', to: 'start' },
      ],
    });
    const found = check(v01TriggerShape, ir);

    expect(codes(found)).toEqual(['V01']);
    expect(found[0]?.severity).toBe('error');
    expect(found[0]?.edgeId).toBe('e2');
  });
});

describe('V02 structural integrity', () => {
  it('accepts a document whose edges name real nodes and declared ports', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, YES_NO_BRANCH, { id: 'work' }],
      edges: [
        { from: 'start', to: 'decide' },
        { from: 'decide', port: 'yes', to: 'work' },
      ],
    });

    expect(check(v02Structure, ir)).toEqual([]);
  });

  it('rejects two nodes sharing an id', () => {
    const ir = makeIR({ nodes: [{ id: 'work' }, { id: 'work' }] });
    const found = check(v02Structure, ir);

    expect(codes(found)).toEqual(['V02']);
    expect(found[0]?.nodeId).toBe('work');
  });

  it('rejects an edge naming a node that does not exist', () => {
    const ir = makeIR({
      nodes: [{ id: 'work' }],
      edges: [{ from: 'work', to: 'ghost' }],
    });
    const found = check(v02Structure, ir);

    expect(codes(found)).toEqual(['V02']);
    expect(found[0]?.edgeId).toBe('e1');
  });

  it('rejects an edge leaving a branch by a port it does not have', () => {
    const ir = makeIR({
      nodes: [YES_NO_BRANCH, { id: 'work' }],
      edges: [{ from: 'decide', port: 'maybe', to: 'work' }],
    });
    const found = check(v02Structure, ir);

    expect(codes(found)).toEqual(['V02']);
    expect(found[0]?.edgeId).toBe('e1');
  });
});

describe('V03 reachability', () => {
  it('accepts a document where the trigger leads everywhere', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'first' }, { id: 'second' }],
      edges: [
        { from: 'start', to: 'first' },
        { from: 'first', to: 'second' },
      ],
    });

    expect(check(v03Reachability, ir)).toEqual([]);
  });

  it('warns, and only warns, about a node the trigger cannot reach', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'first' }, { id: 'island' }],
      edges: [{ from: 'start', to: 'first' }],
    });
    const found = check(v03Reachability, ir);

    expect(codes(found)).toEqual(['V03']);
    expect(found[0]?.severity).toBe('warning');
    expect(found[0]?.nodeId).toBe('island');
  });

  it('says nothing about a branch port with no edge on it', () => {
    // An unconnected else port is where a run
    // ends, not an omission — the canonical
    // workflow ships with one.
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, YES_NO_BRANCH, { id: 'work' }],
      edges: [
        { from: 'start', to: 'decide' },
        { from: 'decide', port: 'yes', to: 'work' },
      ],
    });

    expect(check(v03Reachability, ir)).toEqual([]);
  });
});

describe('V04 acyclicity', () => {
  it('accepts a cycle closed by a declared loop edge', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'work' }, YES_NO_BRANCH],
      edges: [
        { from: 'start', to: 'work' },
        { from: 'work', to: 'decide' },
        { from: 'decide', port: 'yes', to: 'work', back: true },
      ],
    });

    expect(check(v04Acyclicity, ir)).toEqual([]);
  });

  it('rejects the same cycle drawn with ordinary edges', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'work' }, YES_NO_BRANCH],
      edges: [
        { from: 'start', to: 'work' },
        { from: 'work', to: 'decide' },
        { from: 'decide', port: 'yes', to: 'work' },
      ],
    });

    expect(codes(check(v04Acyclicity, ir))).toEqual(['V04']);
  });
});

describe('V05 back edges', () => {
  it('accepts a loop edge from a branch case to a node that dominates it', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'work' }, YES_NO_BRANCH],
      edges: [
        { from: 'start', to: 'work' },
        { from: 'work', to: 'decide' },
        { from: 'decide', port: 'yes', to: 'work', back: true },
      ],
    });

    expect(check(v05BackEdges, ir)).toEqual([]);
  });

  it('rejects a loop edge leaving a node that is not a branch', () => {
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'work' }, { id: 'again' }],
      edges: [
        { from: 'start', to: 'work' },
        { from: 'work', to: 'again' },
        { id: 'e3', from: 'again', to: 'work', back: true },
      ],
    });
    const found = check(v05BackEdges, ir);

    expect(codes(found)).toEqual(['V05']);
    expect(found[0]?.edgeId).toBe('e3');
  });

  it('rejects a loop edge back to a node the run could have skipped', () => {
    // `left` is not on every path to the branch,
    // so re-entering there would restart a run at
    // a step it may never have taken.
    const ir = makeIR({
      nodes: [
        EVENT_TRIGGER,
        { ...YES_NO_BRANCH, id: 'split' },
        { id: 'left' },
        { id: 'right' },
        { ...YES_NO_BRANCH, id: 'decide' },
      ],
      edges: [
        { from: 'start', to: 'split' },
        { from: 'split', port: 'yes', to: 'left' },
        { from: 'split', port: 'no', to: 'right' },
        { from: 'left', to: 'decide' },
        { from: 'right', to: 'decide' },
        { id: 'e6', from: 'decide', port: 'yes', to: 'left', back: true },
      ],
    });
    const found = check(v05BackEdges, ir);

    expect(codes(found)).toEqual(['V05']);
    expect(found[0]?.edgeId).toBe('e6');
  });
});

describe('V06 edge types', () => {
  it('accepts an edge whose type both ends declare', () => {
    const ir = makeIR({
      nodes: [
        { id: 'producer', out: 'SlotGrid' },
        { id: 'consumer', in: 'SlotGrid' },
      ],
      edges: [{ from: 'producer', to: 'consumer', type: 'SlotGrid' }],
    });

    expect(check(v06EdgeTypes, ir)).toEqual([]);
  });

  it('rejects an edge whose type contradicts what the consumer takes', () => {
    const ir = makeIR({
      nodes: [
        { id: 'producer', out: 'SlotGrid' },
        { id: 'consumer', in: 'Booking' },
      ],
      edges: [{ from: 'producer', to: 'consumer', type: 'SlotGrid' }],
    });
    const found = check(v06EdgeTypes, ir);

    expect(codes(found)).toEqual(['V06']);
    expect(found[0]?.edgeId).toBe('e1');
  });

  it('rejects a type the code-behind does not export, once there is a manifest to check', () => {
    const ir = makeIR({
      nodes: [
        { id: 'producer', out: 'Ghost' },
        { id: 'consumer', in: 'Ghost' },
      ],
      edges: [{ from: 'producer', to: 'consumer', type: 'Ghost' }],
    });

    expect(check(v06EdgeTypes, ir)).toEqual([]);
    expect(
      codes(check(v06EdgeTypes, ir, manifestWith({ types: ['SlotGrid'] }))),
    ).toEqual(['V06']);
  });

  it('accepts an edge leaving a node that declares no output', () => {
    // A branch declares what it takes in and
    // nothing about what leaves it, so the edge
    // type is the only claim being made and there
    // is nothing for it to contradict.
    const ir = makeIR({
      nodes: [YES_NO_BRANCH, { id: 'work', in: 'SlotGrid' }],
      edges: [{ from: 'decide', port: 'yes', to: 'work', type: 'SlotGrid' }],
    });

    expect(check(v06EdgeTypes, ir)).toEqual([]);
  });
});

describe('V07 handlers', () => {
  it('accepts a step naming a handler when there is no manifest to check it against', () => {
    const ir = makeIR({
      nodes: [{ id: 'work', handler: { export: 'findSlot' } }],
    });

    expect(check(v07Handlers, ir)).toEqual([]);
  });

  it('warns, and only warns, about a step with no handler yet', () => {
    const ir = makeIR({ nodes: [{ id: 'work' }] });
    const found = check(v07Handlers, ir);

    expect(codes(found)).toEqual(['V07']);
    expect(found[0]?.severity).toBe('warning');
    expect(found[0]?.nodeId).toBe('work');
  });

  it('warns about a handler the code-behind does not export', () => {
    const ir = makeIR({
      nodes: [{ id: 'work', handler: { export: 'findSlot' } }],
    });
    const manifest = manifestWith({
      functions: [
        {
          export: 'parseRequest',
          file: 'lib/parseRequest.ts',
          params: [],
          returnType: 'BookingReq',
        },
      ],
    });
    const found = check(v07Handlers, ir, manifest);

    expect(codes(found)).toEqual(['V07']);
    expect(found[0]?.severity).toBe('warning');
  });
});

describe('V08 loop bodies', () => {
  const loop = (body: string[]): NodeSpec => ({
    id: 'rounds',
    kind: 'loop',
    config: { minRounds: 1, maxRounds: 3, body },
  });

  it('accepts a body that is one chain, entered once and left once', () => {
    const ir = makeIR({
      nodes: [
        EVENT_TRIGGER,
        loop(['draft', 'review']),
        { id: 'draft' },
        { id: 'review' },
        { id: 'publish' },
      ],
      edges: [
        { from: 'start', to: 'rounds' },
        { from: 'rounds', to: 'draft' },
        { from: 'draft', to: 'review' },
        { from: 'review', to: 'publish' },
      ],
    });

    expect(check(v08LoopBodies, ir)).toEqual([]);
  });

  it('rejects an edge that reaches into the middle of the body', () => {
    const ir = makeIR({
      nodes: [
        EVENT_TRIGGER,
        loop(['draft', 'review']),
        { id: 'draft' },
        { id: 'review' },
        { id: 'publish' },
      ],
      edges: [
        { from: 'start', to: 'rounds' },
        { from: 'rounds', to: 'draft' },
        { from: 'draft', to: 'review' },
        { from: 'review', to: 'publish' },
        { from: 'start', to: 'review' },
      ],
    });
    const found = check(v08LoopBodies, ir);

    expect(codes(found)).toEqual(['V08']);
    expect(found[0]?.nodeId).toBe('rounds');
  });

  it('rejects a body member that skips ahead past the next one', () => {
    const ir = makeIR({
      nodes: [
        EVENT_TRIGGER,
        loop(['draft', 'review', 'polish']),
        { id: 'draft' },
        { id: 'review' },
        { id: 'polish' },
      ],
      edges: [
        { from: 'start', to: 'rounds' },
        { from: 'rounds', to: 'draft' },
        { from: 'draft', to: 'review' },
        { from: 'review', to: 'polish' },
        { from: 'draft', to: 'polish' },
      ],
    });

    expect(codes(check(v08LoopBodies, ir))).toEqual(['V08']);
  });

  it('rejects a body whose members are not linked to each other', () => {
    const ir = makeIR({
      nodes: [
        EVENT_TRIGGER,
        loop(['draft', 'review']),
        { id: 'draft' },
        { id: 'review' },
      ],
      edges: [
        { from: 'start', to: 'rounds' },
        { from: 'rounds', to: 'draft' },
      ],
    });

    expect(codes(check(v08LoopBodies, ir))).toEqual(['V08']);
  });
});

describe('V09 form waits', () => {
  const emailWithForm: NodeSpec = {
    id: 'ask',
    kind: 'emailSend',
    config: {
      to: 'requestingUser',
      subject: 'One question',
      bodyMarkdown: 'Please answer',
      attach: {
        type: 'form',
        form: { fields: [{ id: 'ok', label: 'OK?', type: 'yesNo' }] },
      },
    },
  };

  const waitOn = (email: string): NodeSpec => ({
    id: 'await_reply',
    kind: 'durableWait',
    config: { source: { kind: 'form', email }, onTimeout: 'abort' },
  });

  it('accepts a wait on an email that carries a form', () => {
    const ir = makeIR({ nodes: [emailWithForm, waitOn('ask')] });

    expect(check(v09FormWaits, ir)).toEqual([]);
  });

  it('rejects a wait on an email with nothing to answer', () => {
    const ir = makeIR({
      nodes: [
        {
          ...emailWithForm,
          config: {
            to: 'requestingUser',
            subject: 'Just so you know',
            bodyMarkdown: 'No reply needed',
            attach: { type: 'none' },
          },
        },
        waitOn('ask'),
      ],
    });
    const found = check(v09FormWaits, ir);

    expect(codes(found)).toEqual(['V09']);
    expect(found[0]?.nodeId).toBe('await_reply');
  });

  it('rejects a wait pointing at something that is not an email', () => {
    const ir = makeIR({ nodes: [{ id: 'ask' }, waitOn('ask')] });

    expect(codes(check(v09FormWaits, ir))).toEqual(['V09']);
  });
});

describe('V10 guarded consumers', () => {
  const guard = { path: 'uploads', op: 'nonempty' } as const;

  it('accepts a consumer that declares no input of its own', () => {
    const ir = makeIR({
      nodes: [{ id: 'maybe', out: 'Booking', guard }, { id: 'after' }],
      edges: [{ from: 'maybe', to: 'after', type: 'Booking' }],
    });

    expect(check(v10GuardedConsumers, ir)).toEqual([]);
  });

  it('accepts a consumer skipped under the same condition', () => {
    const ir = makeIR({
      nodes: [
        { id: 'maybe', out: 'Booking', guard },
        { id: 'after', in: 'Booking', guard },
      ],
      edges: [{ from: 'maybe', to: 'after', type: 'Booking' }],
    });

    expect(check(v10GuardedConsumers, ir)).toEqual([]);
  });

  it('rejects a consumer that requires an input its producer may never produce', () => {
    const ir = makeIR({
      nodes: [
        { id: 'maybe', out: 'Booking', guard },
        { id: 'after', in: 'Booking' },
      ],
      edges: [{ from: 'maybe', to: 'after', type: 'Booking' }],
    });
    const found = check(v10GuardedConsumers, ir);

    expect(codes(found)).toEqual(['V10']);
    expect(found[0]?.nodeId).toBe('after');
  });
});

describe('V11 requester address', () => {
  const emailToRequester: NodeSpec = {
    id: 'confirm',
    kind: 'emailSend',
    config: {
      to: 'requestingUser',
      subject: 'Confirmed',
      bodyMarkdown: 'Done',
      attach: { type: 'none' },
    },
  };

  it('accepts an email to the requester when the trigger says where to find them', () => {
    const ir = makeIR({ nodes: [EVENT_TRIGGER, emailToRequester] });

    expect(check(v11RequesterAddress, ir)).toEqual([]);
  });

  it('rejects it when the event trigger declares no requester path', () => {
    const ir = makeIR({
      nodes: [
        {
          id: 'start',
          kind: 'trigger',
          config: { mode: 'event', topic: 'booking.requested' },
        },
        emailToRequester,
      ],
    });
    const found = check(v11RequesterAddress, ir);

    expect(codes(found)).toEqual(['V11']);
    expect(found[0]?.nodeId).toBe('confirm');
  });

  it('rejects it when the run is started by hand', () => {
    const ir = makeIR({
      nodes: [
        { id: 'start', kind: 'trigger', config: { mode: 'manual' } },
        emailToRequester,
      ],
    });

    expect(codes(check(v11RequesterAddress, ir))).toEqual(['V11']);
  });
});
