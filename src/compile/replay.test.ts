import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { readFixture } from '../test-support/fixtures.js';
import {
  FOR_EACH,
  GOLDENS,
  GUARDED_CHAIN,
  STEP,
  TRANSACTION,
  irFixture,
} from '../test-support/goldens.js';
import { makeIR, type NodeSpec } from '../test-support/ir.js';

import { nameLiteralShape, recordedNameLiterals } from './audit.js';
import {
  matchTrace,
  replayBoundaries,
  traceGrammar,
  traceShapes,
  type RecordedRow,
  type TraceMatch,
} from './replay.js';

/**
 * A row that ran and finished. A test that cares
 * how a row ended says so in the third argument,
 * which is the only thing any of these rules reads
 * beyond the name.
 */
function row(
  functionId: number,
  name: string,
  outcome: Partial<RecordedRow> = {},
): RecordedRow {
  return {
    functionId,
    name,
    completedAt: 1_700_000_000,
    failed: false,
    ...outcome,
  };
}

const askDetails: NodeSpec = {
  id: 'ask_details',
  kind: 'emailSend',
  title: 'Ask for the details',
  config: {
    to: 'requestingUser',
    subject: 'A few details, please',
    bodyMarkdown: 'We need a little more before we can start.',
    attach: {
      type: 'form',
      form: { fields: [{ id: 'name', label: 'Your name', type: 'text' }] },
    },
  },
};

const awaitDetails: NodeSpec = {
  id: 'await_details',
  kind: 'durableWait',
  title: 'Wait for the details',
  config: {
    source: { kind: 'form', email: 'ask_details' },
    onTimeout: 'resend',
    maxResends: 2,
  },
};

describe('replayBoundaries', () => {
  it('offers every row a run recorded', () => {
    const ir = makeIR({
      nodes: [
        { id: 'parse_request', title: 'Parse the request' },
        { id: 'find_slot', title: 'Find a slot' },
        { id: 'book_appointment', title: 'Book the appointment' },
      ],
    });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'parse_request'),
      row(2, 'find_slot'),
      row(3, 'book_appointment'),
    ]);

    expect(offered).toEqual([
      {
        functionId: 1,
        nodeId: 'parse_request',
        label: 'Parse the request',
        preferred: true,
      },
      {
        functionId: 2,
        nodeId: 'find_slot',
        label: 'Find a slot',
        preferred: true,
      },
      {
        functionId: 3,
        nodeId: 'book_appointment',
        label: 'Book the appointment',
        preferred: true,
      },
    ]);
    expect(unoffered).toEqual([]);
  });

  it('prefers the row that failed over the row that worked', () => {
    // The story a person is living through is
    // failure, fix, replay — so a block's default
    // is where it stopped, not where it started.
    // A row that failed has no completion time
    // either, and that must not read as a run
    // still sitting there.
    const ir = makeIR({ nodes: [{ id: 'charge_card', title: 'Charge it' }] });

    const { offered } = replayBoundaries(ir, [
      row(4, 'charge_card.r1'),
      row(9, 'charge_card.r2', { completedAt: undefined, failed: true }),
    ]);

    expect(
      offered.map((boundary) => [boundary.functionId, boundary.preferred]),
    ).toEqual([
      [4, false],
      [9, true],
    ]);
  });

  it('never offers a row the SDK recorded for itself', () => {
    const ir = makeIR({
      nodes: [{ id: 'record_booking', title: 'Record the booking' }],
    });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'DBOS.recv'),
      row(2, 'getStatus'),
      row(3, 'record_booking'),
    ]);

    expect(offered.map((boundary) => boundary.functionId)).toEqual([3]);
    expect(unoffered).toEqual([
      { functionId: 1, because: 'sdk-owned' },
      { functionId: 2, because: 'sdk-owned' },
    ]);
  });

  it('leaves a timer wait no boundary of its own', () => {
    // Sleeping is the whole of what a timer wait
    // records, and the sleep is the SDK's row, so
    // the block itself is nowhere to resume from.
    const ir = makeIR({
      nodes: [
        {
          id: 'cool_off',
          kind: 'durableWait',
          title: 'Cool off',
          config: {
            source: { kind: 'timer', seconds: 900 },
            onTimeout: 'abort',
          },
        },
        { id: 'record_booking', title: 'Record the booking' },
      ],
    });

    const { offered } = replayBoundaries(ir, [
      row(1, 'DBOS.sleep'),
      row(2, 'record_booking'),
    ]);

    expect(offered.map((boundary) => boundary.nodeId)).toEqual([
      'record_booking',
    ]);
  });

  it('offers nothing from the middle of a wait', () => {
    // Resuming from the row that clears the
    // correlation would hand the new run an answer
    // that arrived for the old one, and resuming
    // from a reminder would send a link the new
    // run cannot be reached through.
    const ir = makeIR({ nodes: [askDetails, awaitDetails] });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'await_details.resend.1'),
      row(2, 'await_details.clear'),
    ]);

    expect(offered).toEqual([]);
    expect(unoffered).toEqual([
      { functionId: 1, because: 'inside-wait' },
      { functionId: 2, because: 'inside-wait' },
    ]);
  });

  it('sends a form wait back to the email that opens it', () => {
    // The link sitting in somebody's inbox names
    // the run it was minted for. Resuming from the
    // email mints one that names the new run;
    // resuming from the wait leaves the answer
    // going to a run nobody is watching.
    const ir = makeIR({ nodes: [askDetails, awaitDetails] });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'ask_details'),
      row(2, 'await_details.register'),
    ]);

    expect(offered.map((boundary) => boundary.nodeId)).toEqual(['ask_details']);
    expect(unoffered).toEqual([
      { functionId: 2, because: 'link-scoped', instead: 'ask_details' },
    ]);
  });

  it('keeps a form wait link-scoped from inside a loop', () => {
    // The shape a wait that is asked twice really
    // records: the round is on the row, and it
    // changes nothing about whose link it is.
    const ir = makeIR({ nodes: [askDetails, awaitDetails] });

    const { unoffered } = replayBoundaries(ir, [
      row(1, 'await_details.r2.register'),
    ]);

    expect(unoffered).toEqual([
      { functionId: 1, because: 'link-scoped', instead: 'ask_details' },
    ]);
  });

  it('offers an event wait the row that registers it', () => {
    // Nothing was mailed, so there is no link to
    // mint again and nowhere else to send a person.
    const ir = makeIR({
      nodes: [
        {
          id: 'await_shipment',
          kind: 'durableWait',
          title: 'Wait for the shipment',
          config: {
            source: {
              kind: 'event',
              topic: 'shipment.sent',
              correlationPath: 'orderId',
              correlateWith: 'id',
            },
            onTimeout: 'abort',
          },
        },
      ],
    });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'await_shipment.register'),
    ]);

    expect(offered).toEqual([
      {
        functionId: 1,
        nodeId: 'await_shipment',
        label: 'Wait for the shipment · register',
        preferred: true,
      },
    ]);
    expect(unoffered).toEqual([]);
  });

  it('offers the mail an approval asks its question in', () => {
    // An approval is its own email, so the row
    // that asks is both the block's first row and
    // the one that mints a fresh link. The row
    // that registers the correlation is not: the
    // link already in the approver's inbox names
    // the run it was minted for, so beginning
    // again there would correlate a new run to an
    // answer that can only come back for the old
    // one. The block to begin at instead is this
    // same one, whose own first row mints a fresh
    // link.
    const ir = makeIR({
      nodes: [
        {
          id: 'manager_ok',
          kind: 'approval',
          title: 'Request approval',
          config: { to: 'ops@example.com' },
        },
      ],
    });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'manager_ok.ask'),
      row(2, 'manager_ok.register'),
      row(3, 'manager_ok.clear'),
    ]);

    expect(offered).toEqual([
      {
        functionId: 1,
        nodeId: 'manager_ok',
        label: 'Request approval · ask',
        preferred: true,
      },
    ]);
    expect(unoffered).toEqual([
      { functionId: 2, because: 'link-scoped', instead: 'manager_ok' },
      { functionId: 3, because: 'inside-wait' },
    ]);
  });

  it('keeps an approval link-scoped from inside a loop', () => {
    // The round is on the row and changes nothing
    // about whose link it is, exactly as it does
    // not for a form wait.
    const ir = makeIR({
      nodes: [
        {
          id: 'manager_ok',
          kind: 'approval',
          title: 'Request approval',
          config: { to: 'ops@example.com' },
        },
      ],
    });

    const { unoffered } = replayBoundaries(ir, [
      row(1, 'manager_ok.r2.register'),
    ]);

    expect(unoffered).toEqual([
      { functionId: 1, because: 'link-scoped', instead: 'manager_ok' },
    ]);
  });

  it('does not offer the point a parked run is sitting at', () => {
    // Said of the row rather than of the SDK that
    // owns it: that the run is there now is what a
    // person needs to know, and it is true of the
    // frontier whatever recorded it.
    const ir = makeIR({ nodes: [askDetails, awaitDetails] });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'ask_details'),
      row(2, 'await_details.register'),
      row(3, 'DBOS.recv', { completedAt: undefined }),
    ]);

    expect(offered.map((boundary) => boundary.functionId)).toEqual([1]);
    expect(unoffered).toContainEqual({
      functionId: 3,
      because: 'parked-here',
    });
  });

  it('offers each round of a loop under its own number', () => {
    // Going round again re-runs work that
    // succeeded, which is a choice a person may
    // want, so every round is on offer and the
    // first one is the block's default.
    const ir = makeIR({ nodes: [{ id: 'find_slot', title: 'Find a slot' }] });

    const { offered } = replayBoundaries(ir, [
      row(1, 'find_slot.r1'),
      row(2, 'find_slot.r2'),
    ]);

    expect(offered.map((boundary) => boundary.label)).toEqual([
      'Find a slot · round 1',
      'Find a slot · round 2',
    ]);
    expect(offered.map((boundary) => boundary.preferred)).toEqual([
      true,
      false,
    ]);
  });

  it('offers each item of a fan-out under its own index', () => {
    const ir = makeIR({ nodes: [{ id: 'notify', title: 'Notify' }] });

    const { offered } = replayBoundaries(ir, [
      row(1, 'notify[7]'),
      row(2, 'notify[8]'),
    ]);

    expect(offered.map((boundary) => boundary.label)).toEqual([
      'Notify · item 7',
      'Notify · item 8',
    ]);
  });

  it('says nothing at all about a row that names no block here', () => {
    // A run outlives the document it was compiled
    // from: a block gets renamed, a block gets
    // deleted. Neither row is a boundary, and
    // neither is a reason to tell a person
    // something about a block they cannot see.
    const ir = makeIR({ nodes: [{ id: 'find_slot', title: 'Find a slot' }] });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'gone_away'),
      row(2, 'a b c'),
      row(3, 'find_slot'),
    ]);

    expect(offered.map((boundary) => boundary.functionId)).toEqual([3]);
    expect(unoffered).toEqual([]);
  });

  it('still says where a parked run is when its block is gone', () => {
    // The one thing worth saying about a block a
    // person cannot see: the run is sitting there
    // now. Where a run is does not stop being true
    // because somebody renamed the block it is in,
    // and a frontier nothing reported would leave
    // the run looking finished.
    const ir = makeIR({ nodes: [{ id: 'find_slot', title: 'Find a slot' }] });

    const { offered, unoffered } = replayBoundaries(ir, [
      row(1, 'find_slot'),
      row(2, 'gone_away.register', { completedAt: undefined }),
    ]);

    expect(offered.map((boundary) => boundary.functionId)).toEqual([1]);
    expect(unoffered).toEqual([{ functionId: 2, because: 'parked-here' }]);
  });
});

/** A run that recorded these names, from id 0. */
function trace(names: readonly string[]): RecordedRow[] {
  return names.map((name, functionId) => row(functionId, name));
}

/**
 * Whether the whole of a recorded run is something
 * `ir` could still produce — which is the question
 * asked of every row below a boundary.
 */
function matches(ir: WorkflowIR, names: readonly string[]): TraceMatch {
  return matchTrace(traceGrammar(ir), trace(names), names.length);
}

/**
 * The same document with one block's settings
 * changed, read back through the schema so a test
 * cannot pass against a document nobody could
 * draw.
 */
function edited(
  ir: WorkflowIR,
  nodeId: string,
  config: Record<string, unknown>,
): WorkflowIR {
  return WorkflowIRSchema.parse({
    ...ir,
    nodes: ir.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, config: { ...node.config, ...config } }
        : node,
    ),
  });
}

/**
 * A wait on a form, with the email that opens it.
 * The reject case below asks what a document like
 * this makes of a run recorded when the same block
 * was a wait on the clock.
 */
const FORM_WAIT = makeIR({
  name: 'settle_then_ask',
  nodes: [
    {
      id: 'booking_placed',
      kind: 'trigger',
      title: 'Booking placed',
      config: { mode: 'event', topic: 'booking.placed' },
    },
    {
      id: 'ask_details',
      kind: 'emailSend',
      title: 'Ask for the details',
      config: {
        to: 'ops@example.com',
        subject: 'A few details, please',
        bodyMarkdown: 'We need a little more before we can start.',
        attach: {
          type: 'form',
          form: { fields: [{ id: 'name', label: 'Your name', type: 'text' }] },
        },
      },
    },
    {
      id: 'settle_delay',
      kind: 'durableWait',
      title: 'Settle',
      config: {
        source: { kind: 'form', email: 'ask_details' },
        onTimeout: 'abort',
      },
    },
    { id: 'record_booking', kind: 'transaction', title: 'Record it' },
  ],
  edges: [
    { from: 'booking_placed', to: 'ask_details' },
    { from: 'ask_details', to: 'settle_delay' },
    { from: 'settle_delay', to: 'record_booking' },
  ],
});

/**
 * A condition with work below it as well as inside
 * it, so a run that skipped the condition still
 * has a row after the gap.
 */
const GUARDED_MIDDLE = makeIR({
  name: 'sometimes_look',
  nodes: [
    {
      id: 'booking_requested',
      kind: 'trigger',
      title: 'Booking request',
      config: { mode: 'event', topic: 'booking.requested' },
    },
    { id: 'parse_request', title: 'Parse the request' },
    {
      id: 'find_slot',
      title: 'Find a slot',
      guard: { path: 'service', op: 'eq', value: 'groom' },
    },
    { id: 'wrap_up', title: 'Wrap up' },
  ],
  edges: [
    { from: 'booking_requested', to: 'parse_request' },
    { from: 'parse_request', to: 'find_slot' },
    { from: 'find_slot', to: 'wrap_up' },
  ],
});

/** A fan-out with work on either side of it, so a
 *  run over no items still records something. */
const FAN_OUT = makeIR({
  name: 'notify_everyone',
  nodes: [
    {
      id: 'batch_ready',
      kind: 'trigger',
      title: 'Batch ready',
      config: { mode: 'event', topic: 'batch.ready' },
    },
    {
      id: 'notify',
      title: 'Notify',
      forEach: { itemsPath: 'people', concurrency: 2 },
    },
    { id: 'wrap_up', title: 'Wrap up' },
  ],
  edges: [
    { from: 'batch_ready', to: 'notify' },
    { from: 'notify', to: 'wrap_up' },
  ],
});

/**
 * One hand-written run per shape the emitter can
 * write.
 *
 * Hand-written on purpose: deriving the rows from
 * the grammar would be the grammar agreeing with
 * itself. What holds these to the emitter is the
 * conformance sweep at the end of this file; what
 * these hold is the order, which a set of names
 * cannot see.
 */
const RUNS: readonly (readonly [string, WorkflowIR, readonly string[]])[] = [
  ['a chain of steps', STEP, ['parse_request', 'find_slot', 'twilio_chat']],
  ['a lone transaction', TRANSACTION, ['record_booking']],
  [
    'a condition that held',
    GUARDED_CHAIN,
    ['parse_request', 'find_slot', 'book_appointment'],
  ],
  ['a condition that did not hold', GUARDED_CHAIN, ['parse_request']],
  [
    'a condition skipped with work below it',
    GUARDED_MIDDLE,
    ['parse_request', 'wrap_up'],
  ],
  [
    'a fan-out over three items',
    FOR_EACH,
    ['confirm_each[0]', 'confirm_each[1]', 'confirm_each[2]'],
  ],
  ['a fan-out over none', FAN_OUT, ['wrap_up']],
  [
    'a wait on the clock',
    irFixture('timer_wait'),
    ['DBOS.sleep', 'record_booking'],
  ],
  [
    'a form answered first time',
    irFixture('form_intake'),
    [
      'ask_details',
      'await_details.register',
      'DBOS.recv',
      'DBOS.sleep',
      'await_details.clear',
      'record_intake',
    ],
  ],
  [
    'an approval that was granted',
    irFixture('approval_flow'),
    [
      'manager_ok.ask',
      'manager_ok.register',
      'DBOS.recv',
      'DBOS.sleep',
      'manager_ok.clear',
      'pay_claim',
      'send_receipt',
      'close_claim',
    ],
  ],
  [
    'an approval that was refused, the other arm absent',
    irFixture('approval_flow'),
    [
      'manager_ok.ask',
      'manager_ok.register',
      'DBOS.recv',
      'DBOS.sleep',
      'manager_ok.clear',
      'file_refusal',
      'close_claim',
    ],
  ],
  [
    'a decision the code made',
    irFixture('decision_yes_no'),
    ['auto_approve', 'pay_claim', 'close_claim'],
  ],
  [
    'the middle way out of three',
    irFixture('branch_three_ways'),
    ['find_slot', 'offer_times', 'wrap_up'],
  ],
  [
    'every round of a counted loop',
    irFixture('review_loop'),
    [
      'find_slot.r1',
      'twilio_chat.r1',
      'find_slot.r2',
      'twilio_chat.r2',
      'find_slot.r3',
      'twilio_chat.r3',
      'find_slot.r4',
      'twilio_chat.r4',
      'read_reply',
    ],
  ],
  [
    'two rounds of a loop drawn as a wire back',
    irFixture('slot_retry_abort'),
    [
      'parse_request',
      'find_slot.r1',
      'look_again.r1',
      'find_slot.r2',
      'look_again.r2',
      'book_appointment',
    ],
  ],
  [
    'the same loop left after one round',
    irFixture('slot_retry_abort'),
    ['parse_request', 'find_slot.r1', 'look_again.r1', 'book_appointment'],
  ],
  [
    'a form asked again once',
    irFixture('form_retry'),
    [
      'ask_details.r1',
      'await_details.r1.register',
      'DBOS.recv',
      'DBOS.sleep',
      'await_details.r1.resend.1',
      'DBOS.recv',
      'DBOS.sleep',
      'await_details.r1.clear',
      'record_intake',
    ],
  ],
  [
    'a form reminded twice and then asked over',
    irFixture('form_retry'),
    [
      'ask_details.r1',
      'await_details.r1.register',
      'DBOS.recv',
      'DBOS.sleep',
      'await_details.r1.resend.1',
      'DBOS.recv',
      'DBOS.sleep',
      'await_details.r1.resend.2',
      'DBOS.recv',
      'DBOS.sleep',
      'await_details.r1.clear',
      'ask_details.r2',
      'await_details.r2.register',
      'DBOS.recv',
      'DBOS.sleep',
      'await_details.r2.clear',
      'record_intake',
    ],
  ],
  [
    'a chat that came back on the first round',
    irFixture('groom_booking'),
    [
      'parse_request',
      'find_slot.r1',
      'twilio_chat.r1',
      'await_reply.r1.register',
      'DBOS.recv',
      'DBOS.sleep',
      'await_reply.r1.clear',
      'book_appointment',
      'record_booking',
      'send_confirmation',
    ],
  ],
  [
    'a loop inside a loop',
    irFixture('slot_retry_rechecked'),
    [
      'parse_request.r1',
      'find_slot.r1.r1',
      'look_again.r1.r1',
      'find_slot.r1.r2',
      'look_again.r1.r2',
      'release_holds',
    ],
  ],
];

describe('matchTrace', () => {
  for (const [what, ir, names] of RUNS) {
    it(`accepts ${what}`, () => {
      expect(matches(ir, names)).toEqual({ ok: true });
    });
  }

  it('accepts a run that is still going', () => {
    // The rows below a boundary are the beginning
    // of a run, not the whole of one, so what is
    // asked is whether the document could have got
    // this far — never whether it would stop here.
    expect(matches(STEP, ['parse_request'])).toEqual({ ok: true });
  });

  it('rejects a block somebody renamed', () => {
    expect(matches(STEP, ['parse_the_request'])).toEqual({
      ok: false,
      at: 0,
      recorded: 'parse_the_request',
      expected: ['parse_request'],
    });
  });

  it('rejects a block added above the point asked about', () => {
    // The run never wrote a row for it, so the
    // rows below the boundary are one short and
    // every row after the new block is a row DBOS
    // would compare against a different name.
    expect(matches(STEP, ['parse_request', 'twilio_chat'])).toEqual({
      ok: false,
      at: 1,
      recorded: 'twilio_chat',
      expected: ['find_slot'],
    });
  });

  it('rejects work recorded below a way out wired to nothing', () => {
    // The last way out of that branch returns, so
    // a run that took it stopped there. No run can
    // have recorded the block after the branch
    // without recording one of the three arms
    // first.
    expect(
      matches(irFixture('branch_three_ways'), ['find_slot', 'wrap_up']),
    ).toEqual({
      ok: false,
      at: 1,
      recorded: 'wrap_up',
      expected: ['book_now', 'offer_times', 'sweep_old'],
    });
  });

  it('rejects a counted loop whose number of rounds moved', () => {
    const shorter = edited(irFixture('review_loop'), 'draft_rounds', {
      maxRounds: 3,
    });

    expect(
      matches(shorter, [
        'find_slot.r1',
        'twilio_chat.r1',
        'find_slot.r2',
        'twilio_chat.r2',
        'find_slot.r3',
        'twilio_chat.r3',
        'find_slot.r4',
      ]),
    ).toEqual({
      ok: false,
      at: 6,
      recorded: 'find_slot.r4',
      expected: ['read_reply'],
    });
  });

  it('rejects a counted loop that stopped short of its rounds', () => {
    // A counted loop has no way out of its own: it
    // runs the number of rounds it was given, so a
    // run that recorded one round and then carried
    // on is not a run of this document.
    expect(
      matches(irFixture('review_loop'), [
        'find_slot.r1',
        'twilio_chat.r1',
        'read_reply',
      ]),
    ).toEqual({
      ok: false,
      at: 2,
      recorded: 'read_reply',
      expected: ['find_slot.r2'],
    });
  });

  it('rejects a reminder from a wait that was told not to remind', () => {
    expect(
      matches(irFixture('form_intake'), [
        'ask_details',
        'await_details.register',
        'DBOS.recv',
        'DBOS.sleep',
        'await_details.resend.1',
      ]),
    ).toEqual({
      ok: false,
      at: 4,
      recorded: 'await_details.resend.1',
      expected: ['await_details.clear'],
    });
  });

  it('rejects a wait told to send fewer reminders than it sent', () => {
    const fewer = edited(irFixture('form_retry'), 'await_details', {
      maxResends: 1,
    });

    expect(
      matches(fewer, [
        'ask_details.r1',
        'await_details.r1.register',
        'DBOS.recv',
        'DBOS.sleep',
        'await_details.r1.resend.1',
        'DBOS.recv',
        'DBOS.sleep',
        'await_details.r1.resend.2',
      ]),
    ).toEqual({
      ok: false,
      at: 7,
      recorded: 'await_details.r1.resend.2',
      expected: ['await_details.r1.clear'],
    });
  });

  it('rejects a wait on the clock that is now a wait on a form', () => {
    // Sleeping is the whole of what a wait on the
    // clock records. A wait on a form writes a row
    // before it parks, and there is no such row in
    // this run to compare against.
    expect(matches(FORM_WAIT, ['ask_details', 'DBOS.sleep'])).toEqual({
      ok: false,
      at: 1,
      recorded: 'DBOS.sleep',
      expected: ['settle_delay.register'],
    });
  });

  it('rejects a run with a hole in it', () => {
    // A hole is a row the run has not written yet,
    // which means it is parked there — and nothing
    // below a park has run, so no boundary lies
    // past one.
    const parked = [row(0, 'parse_request'), row(2, 'twilio_chat')];

    expect(matchTrace(traceGrammar(STEP), parked, 3)).toEqual({
      ok: false,
      at: 1,
      recorded: '',
      expected: ['find_slot'],
    });
  });

  it('ignores everything at or above the point asked about', () => {
    // Replaying from a row means the rows above it
    // are thrown away, so whether the document
    // still agrees with them is nobody's question.
    const rows = trace(['parse_request', 'find_slot', 'wandered_off']);

    expect(matchTrace(traceGrammar(STEP), rows, 2)).toEqual({ ok: true });
  });
});

/**
 * What a document says it can record, held against
 * what the file compiled from it actually records.
 *
 * The grammar is a second reading of the emission
 * plan, and a second reading is only worth having
 * while it agrees with the first. Nothing else
 * would notice it drifting: a golden pins the
 * emitted text and says nothing about the grammar,
 * and every test above this one is the grammar
 * agreeing with rows somebody wrote by hand.
 *
 * Sets of shapes rather than sequences of names,
 * and both halves of that are load-bearing.
 * Shapes, because a round number is a value a run
 * fills in and neither side can know it. Sets,
 * because `form_retry` has exactly one `DBOS.recv(`
 * in its source while a run of it parks once per
 * reminder — no ordering of the two sides could be
 * made to agree.
 */
describe('the shapes a document can record', () => {
  for (const [name, ir] of GOLDENS) {
    it(`are the shapes ${name} records`, () => {
      const source = readFixture(`golden/compile/${name}.workflow.ts`);
      const written = recordedNameLiterals(source).map(nameLiteralShape);

      expect(traceShapes(traceGrammar(ir))).toEqual(
        [...new Set(written)].sort(),
      );
    });
  }
});
