import { describe, expect, it } from 'vitest';

import { makeIR, type NodeSpec } from '../test-support/ir.js';

import { replayBoundaries, type RecordedRow } from './replay.js';

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
    // the one that mints a fresh link.
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
      {
        functionId: 2,
        nodeId: 'manager_ok',
        label: 'Request approval · register',
        preferred: false,
      },
    ]);
    expect(unoffered).toEqual([{ functionId: 3, because: 'inside-wait' }]);
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
});
