import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { LibManifestSchema, type LibManifest } from '../manifest/index.js';
import { readFixtureJson } from '../test-support/fixtures.js';
import { makeIR, type NodeSpec } from '../test-support/ir.js';

import type { Diagnostic } from './diagnostic.js';
import { buildGraph } from './graph.js';
import { canCompile, hasErrors, validateWorkflow } from './index.js';
import {
  RULES,
  sameGuard,
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
  v12SerializableTypes,
  v13HandlerSignatures,
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
    nonSerializable: [],
    errors: [],
    ...parts,
  };
}

/**
 * A blessed scan, read back the way a tool reads
 * one: through the schema, with the instant a
 * golden cannot hold supplied here.
 */
function goldenManifest(name: string): LibManifest {
  return LibManifestSchema.parse({
    scannedAt: '2026-01-01T00:00:00.000Z',
    ...readFixtureJson<Record<string, unknown>>(
      `golden/manifest/${name}.manifest.json`,
    ),
  });
}

function irFixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
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

  it('says nothing about a loop still drafted as an island', () => {
    // Drop the loop's blocks, wire them to each
    // other, then join them to the main flow: no
    // run reaches `decide` until that last step,
    // so there is nothing true to say yet about
    // what a run passes through on the way to it.
    const ir = makeIR({
      nodes: [EVENT_TRIGGER, { id: 'main' }, { id: 'work' }, YES_NO_BRANCH],
      edges: [
        { from: 'start', to: 'main' },
        { from: 'work', to: 'decide' },
        { from: 'decide', port: 'yes', to: 'work', back: true },
      ],
    });

    expect(check(v05BackEdges, ir)).toEqual([]);
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

  it('rejects an untyped edge between ends that contradict each other', () => {
    // Leaving the wire undeclared does not settle
    // the disagreement: the document still says
    // one end makes a `SlotGrid` and the other
    // takes a `Booking`.
    const ir = makeIR({
      nodes: [
        { id: 'find_slot', out: 'SlotGrid' },
        { id: 'book', in: 'Booking' },
      ],
      edges: [{ from: 'find_slot', to: 'book' }],
    });
    const found = check(v06EdgeTypes, ir);

    expect(codes(found)).toEqual(['V06']);
    expect(found[0]?.edgeId).toBe('e1');
  });

  it('accepts an untyped edge whose ends declare the same type', () => {
    const ir = makeIR({
      nodes: [
        { id: 'find_slot', out: 'SlotGrid' },
        { id: 'book', in: 'SlotGrid' },
      ],
      edges: [{ from: 'find_slot', to: 'book' }],
    });

    expect(check(v06EdgeTypes, ir)).toEqual([]);
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

  it('warns about a branch running a function the code-behind does not export', () => {
    const ir = makeIR({
      nodes: [{ ...YES_NO_BRANCH, handler: { export: 'checkDone' } }],
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
    expect(found[0]?.nodeId).toBe('decide');
  });

  it('says nothing about a branch with no handler', () => {
    // A branch tests the value that reached it
    // until somebody gives it code of its own, so a
    // branch without a handler is not missing one.
    const ir = makeIR({ nodes: [YES_NO_BRANCH] });

    expect(check(v07Handlers, ir, manifestWith({}))).toEqual([]);
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

  it('says nothing while the draft has no trigger at all', () => {
    // V01 already reports the missing trigger, as
    // a warning, because a draft is saveable
    // without one. A second finding here would be
    // an error on that same draft, blaming a
    // trigger that is not there to blame.
    const ir = makeIR({ nodes: [emailToRequester] });

    expect(check(v11RequesterAddress, ir)).toEqual([]);
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

describe('V12 serializable types', () => {
  const unserializable = goldenManifest('lib-unserializable');

  it('accepts the canonical workflow against the real scan of its code', () => {
    expect(
      check(
        v12SerializableTypes,
        irFixture('groom_booking'),
        goldenManifest('lib'),
      ),
    ).toEqual([]);
  });

  it('says nothing at all when there is no scan to say it from', () => {
    // No manifest never means "the manifest says
    // no". Validation runs in tools that never
    // scan a project, and a document must not look
    // wrong merely because nothing was there to
    // look at it.
    const ir = makeIR({ nodes: [{ id: 'work', out: 'Upload' }] });

    expect(check(v12SerializableTypes, ir)).toEqual([]);
  });

  it.each(['Ticket', 'Upload', 'Feed', 'Conn', 'Session', 'Job'])(
    'rejects a node that produces %s',
    (type) => {
      const ir = makeIR({ nodes: [{ id: 'work', out: type }] });
      const found = check(v12SerializableTypes, ir, unserializable);

      expect(codes(found)).toEqual(['V12']);
      expect(found[0]?.severity).toBe('error');
      expect(found[0]?.nodeId).toBe('work');
      expect(found[0]?.edgeId).toBeUndefined();
    },
  );

  it('names the member at fault, however deep in the type it sits', () => {
    const ir = makeIR({ nodes: [{ id: 'work', out: 'Job' }] });
    const found = check(v12SerializableTypes, ir, unserializable);

    expect(found[0]?.message).toContain('`Job.payload.onDone`');
  });

  it('names the type itself when the type itself is what cannot travel', () => {
    const ir = makeIR({ nodes: [{ id: 'work', out: 'Session' }] });
    const found = check(v12SerializableTypes, ir, unserializable);

    expect(found[0]?.message).toContain('`Session` is a class with methods');
  });

  it('accepts a type of nothing but data', () => {
    const ir = makeIR({ nodes: [{ id: 'work', out: 'Plain' }] });

    expect(check(v12SerializableTypes, ir, unserializable)).toEqual([]);
  });

  it('reports both ends when the same type goes in and comes out', () => {
    const ir = makeIR({
      nodes: [{ id: 'work', in: 'Upload', out: 'Upload' }],
    });
    const found = check(v12SerializableTypes, ir, unserializable);

    expect(codes(found)).toEqual(['V12', 'V12']);
    expect(found[0]?.message).toContain('takes');
    expect(found[1]?.message).toContain('produces');
  });

  it('stops a document that carries one from compiling', () => {
    const manifest = manifestWith({
      types: ['Upload'],
      functions: [
        {
          export: 'takeUpload',
          file: 'lib/upload.ts',
          params: [],
          returnType: 'Upload',
        },
      ],
      nonSerializable: [{ type: 'Upload', path: 'body', reason: 'buffer' }],
    });
    const ir = makeIR({
      nodes: [
        { id: 'start', kind: 'trigger', config: { mode: 'manual' } },
        { id: 'work', out: 'Upload', handler: { export: 'takeUpload' } },
      ],
      edges: [{ from: 'start', to: 'work' }],
    });
    const found = validateWorkflow(ir, { manifest });

    expect(codes(found)).toEqual(['V12']);
    expect(hasErrors(found)).toBe(true);
    expect(canCompile(ir, found)).toBe(false);
  });
});

describe('V13 handler signatures', () => {
  const manifest = manifestWith({
    types: ['SlotGrid', 'BookingReq', 'Booking'],
    functions: [
      {
        export: 'findSlot',
        file: 'lib/findSlot.ts',
        params: [{ name: 'req', type: 'BookingReq' }],
        returnType: 'SlotGrid',
      },
      {
        export: 'countAll',
        file: 'lib/countAll.ts',
        params: [{ name: 'items', type: 'Booking[]' }],
        returnType: 'number',
      },
      {
        export: 'listAll',
        file: 'lib/listAll.ts',
        params: [],
        returnType: 'SlotGrid',
      },
      {
        export: 'pairUp',
        file: 'lib/pairUp.ts',
        params: [
          { name: 'req', type: 'BookingReq' },
          { name: 'grid', type: 'SlotGrid' },
        ],
        returnType: 'Booking',
      },
    ],
  });

  it('accepts a node whose declarations match its handler', () => {
    const ir = makeIR({
      nodes: [
        {
          id: 'find_slot',
          in: 'BookingReq',
          out: 'SlotGrid',
          handler: { export: 'findSlot' },
        },
      ],
    });

    expect(check(v13HandlerSignatures, ir, manifest)).toEqual([]);
  });

  it('rejects an input the handler does not take', () => {
    const ir = makeIR({
      nodes: [
        { id: 'find_slot', in: 'SlotGrid', handler: { export: 'findSlot' } },
      ],
    });
    const found = check(v13HandlerSignatures, ir, manifest);

    expect(codes(found)).toEqual(['V13']);
    expect(found[0]?.severity).toBe('error');
    expect(found[0]?.nodeId).toBe('find_slot');
    expect(found[0]?.message).toContain('`SlotGrid`');
    expect(found[0]?.message).toContain('`BookingReq`');
  });

  it('rejects an output the handler does not return', () => {
    const ir = makeIR({
      nodes: [
        { id: 'find_slot', out: 'Booking', handler: { export: 'findSlot' } },
      ],
    });
    const found = check(v13HandlerSignatures, ir, manifest);

    expect(codes(found)).toEqual(['V13']);
    expect(found[0]?.message).toContain('`SlotGrid`');
  });

  it('accepts the canonical workflow against the real scan of its code', () => {
    expect(
      check(
        v13HandlerSignatures,
        irFixture('groom_booking'),
        goldenManifest('lib'),
      ),
    ).toEqual([]);
  });

  it('says nothing when there is no scan to compare against', () => {
    const ir = makeIR({
      nodes: [
        { id: 'find_slot', in: 'SlotGrid', handler: { export: 'findSlot' } },
      ],
    });

    expect(check(v13HandlerSignatures, ir)).toEqual([]);
  });

  it('says nothing about a node with no handler yet', () => {
    const ir = makeIR({ nodes: [{ id: 'find_slot', in: 'SlotGrid' }] });

    expect(check(v13HandlerSignatures, ir, manifest)).toEqual([]);
  });

  it('says nothing when the handler is not in the manifest', () => {
    // A handler the code-behind does not export is
    // V07's finding. Reporting it twice, under two
    // codes, tells an author to fix two things.
    const ir = makeIR({
      nodes: [
        { id: 'find_slot', in: 'SlotGrid', handler: { export: 'notThere' } },
      ],
    });

    expect(check(v13HandlerSignatures, ir, manifest)).toEqual([]);
  });

  it('says nothing when the handler takes nothing at all', () => {
    // The generated call hands an argument to a
    // handler that declares no parameter, and the
    // compiler says so at the type-check gate in
    // words this rule could not improve on.
    const ir = makeIR({
      nodes: [
        { id: 'list_all', in: 'BookingReq', handler: { export: 'listAll' } },
      ],
    });

    expect(check(v13HandlerSignatures, ir, manifest)).toEqual([]);
  });

  it('says nothing about a node that fans out over its input', () => {
    const ir = makeIR({
      nodes: [
        {
          id: 'find_slot',
          in: 'SlotGrid',
          handler: { export: 'findSlot' },
          forEach: { itemsPath: 'items' },
        },
      ],
    });

    expect(check(v13HandlerSignatures, ir, manifest)).toEqual([]);
  });

  it('says nothing about a handler that takes more than one value', () => {
    // Such a function is greyed in the picker and
    // refused at the drop target, and the generated
    // code's own type-check refuses it a third
    // time. A diagnostic here would be read off a
    // cache that may not have recorded which
    // parameters a call may leave out, and would
    // put an error on a handler that compiles.
    const ir = makeIR({
      nodes: [{ id: 'pair_up', in: 'SlotGrid', handler: { export: 'pairUp' } }],
    });

    expect(check(v13HandlerSignatures, ir, manifest)).toEqual([]);
  });

  it('says nothing when the handler’s type is not a plain name', () => {
    const ir = makeIR({
      nodes: [
        { id: 'count_all', in: 'Booking', handler: { export: 'countAll' } },
      ],
    });

    expect(check(v13HandlerSignatures, ir, manifest)).toEqual([]);
  });
});

describe('the rule list', () => {
  it('ends with the two rules that read the scan’s structure, in order', () => {
    expect(RULES.slice(-2)).toEqual([
      v12SerializableTypes,
      v13HandlerSignatures,
    ]);
  });
});

describe('sameGuard', () => {
  const guard = { path: 'ok', op: 'eq', value: true } as const;

  it('calls two nodes with no condition equally guarded', () => {
    expect(sameGuard(undefined, undefined)).toBe(true);
  });

  it('calls a guarded node and an unguarded one different', () => {
    expect(sameGuard(guard, undefined)).toBe(false);
    expect(sameGuard(undefined, guard)).toBe(false);
  });

  it('compares the path, the operator and the value', () => {
    expect(sameGuard(guard, { ...guard })).toBe(true);
    expect(sameGuard(guard, { ...guard, value: false })).toBe(false);
    expect(sameGuard(guard, { ...guard, op: 'neq' })).toBe(false);
    expect(sameGuard(guard, { ...guard, path: 'other' })).toBe(false);
  });
});
