import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { readFixtureJson } from '../test-support/fixtures.js';
import { makeIR, type NodeSpec } from '../test-support/ir.js';

import {
  planWorkflow,
  type PlanArm,
  type PlanItem,
  type PlanRegion,
} from './plan.js';
import { UnsupportedIR } from './unsupported.js';

/**
 * What the planner decides, asked of the planner.
 *
 * Most of what it works out is visible in the
 * emitted file and pinned by a golden, and that is
 * the right place for the shape of the output. A
 * loop's membership is not. Two documents that
 * disagree about which blocks a loop holds can
 * emit the same file right up until the day one of
 * them is refused — and then the refusal names a
 * block a reader cannot find in the loop it names.
 * So what is asked here is what a golden cannot
 * ask: which blocks a loop holds, and whether a
 * document plans at all.
 */

type Repeat = Extract<PlanItem, { kind: 'repeat' }>;

const TRIGGER: NodeSpec = {
  id: 'review_started',
  kind: 'trigger',
  title: 'Review started',
  out: 'BookingReq',
  config: { mode: 'event', topic: 'review.started' },
};

const FIND_SLOT: NodeSpec = {
  id: 'find_slot',
  kind: 'step',
  title: 'Find open slot',
  handler: { export: 'findSlot' },
  in: 'BookingReq',
  out: 'SlotGrid',
  config: {},
};

/**
 * What the planner refuses to plan.
 *
 * Asked of the planner rather than of a compiled
 * file: these are its refusals, and a document it
 * turns down never reaches an emitter, so going
 * through one would only put two more layers
 * between the shape under test and the sentence
 * about it.
 */
function refusal(ir: WorkflowIR): UnsupportedIR {
  try {
    planWorkflow(ir);
  } catch (error) {
    if (error instanceof UnsupportedIR) return error;
    throw error;
  }

  throw new Error('planned without refusing it');
}

function fixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

/** The blocks in a region, in the order they run. */
function idsIn(region: PlanRegion): string[] {
  return region.flatMap((item) => {
    switch (item.kind) {
      case 'blocks':
        return item.group.nodes.map((node) => node.id);
      case 'branch':
      case 'approval':
        return [item.node.id, ...armIds(item.arms)];
      case 'countedLoop':
        return [item.node.id, ...idsIn(item.body)];
      case 'repeat':
        return idsIn(item.body);
    }
  });
}

function armIds(arms: readonly PlanArm[]): string[] {
  return arms.flatMap((arm) =>
    arm.target.kind === 'region' ? idsIn(arm.target.region) : [],
  );
}

/** Every loop that closes with a back edge, outermost first. */
function repeatsIn(region: PlanRegion): Repeat[] {
  return region.flatMap((item) => {
    switch (item.kind) {
      case 'repeat':
        return [item, ...repeatsIn(item.body)];
      case 'countedLoop':
        return repeatsIn(item.body);
      case 'branch':
      case 'approval':
        return item.arms.flatMap((arm) =>
          arm.target.kind === 'region' ? repeatsIn(arm.target.region) : [],
        );
      case 'blocks':
        return [];
    }
  });
}

describe('a loop that closes with a back edge', () => {
  it('holds the blocks between its entry and the branch that closes it', () => {
    const [loop, ...rest] = repeatsIn(
      planWorkflow(fixture('slot_retry_continue')).region,
    );

    expect(rest).toEqual([]);
    expect(loop?.entry.id).toBe('find_slot');
    expect(loop?.branch.id).toBe('look_again');
    expect(idsIn(loop?.body ?? [])).toEqual(['find_slot', 'look_again']);
  });
});

describe('a loop drawn inside another loop', () => {
  const plan = planWorkflow(fixture('slot_retry_rechecked'));

  it('plans both loops, one inside the other', () => {
    const [outer, inner, ...rest] = repeatsIn(plan.region);

    expect(rest).toEqual([]);
    expect([outer?.entry.id, outer?.branch.id]).toEqual([
      'parse_request',
      'still_ok',
    ]);
    expect([inner?.entry.id, inner?.branch.id]).toEqual([
      'find_slot',
      'look_again',
    ]);
  });

  /**
   * The blocks ahead of the inner loop's entry are
   * the whole point of this fixture. `parse_request`
   * and `has_a_time` sit between the outer loop's
   * entry and the inner one's, and a run arrives
   * back at them only by going round the outer
   * loop. That is not a way *ahead* from the inner
   * entry, so it is not a way the inner loop can
   * be left — and `has_a_time`'s second wire is
   * the outer loop's way out, not a second way out
   * of the inner one.
   */
  it('leaves the blocks before its entry to the loop that holds them', () => {
    const [outer, inner] = repeatsIn(plan.region);

    expect(idsIn(outer?.body ?? [])).toEqual([
      'parse_request',
      'has_a_time',
      'find_slot',
      'look_again',
      'still_ok',
    ]);
    expect(idsIn(inner?.body ?? [])).toEqual(['find_slot', 'look_again']);
  });

  it('carries each loop its own bound', () => {
    const [outer, inner] = repeatsIn(plan.region);

    expect([outer?.rounds, outer?.onExhausted]).toEqual([5, 'abort']);
    expect([inner?.rounds, inner?.onExhausted]).toEqual([10, 'continue']);
  });

  it('reads the value a block needs from the block that bound it', () => {
    expect(plan.producers.get('find_slot')).toBe('parse_request');
    expect(plan.producers.get('still_ok')).toBe('find_slot');
  });
});

/**
 * The document declares this the other way round —
 * a wait names the email its form arrives on — and
 * the token an email mints has to be scoped to the
 * wait, so the plan turns it round once and the
 * emitter reads it from there.
 */
describe('a form the run waits on', () => {
  it('says which wait each email opens', () => {
    const plan = planWorkflow(fixture('form_intake'));

    expect([...plan.waitForEmail]).toEqual([['ask_details', 'await_details']]);
  });

  it('has nothing to turn round where no email carries a form', () => {
    const plan = planWorkflow(fixture('slot_retry_continue'));

    expect([...plan.waitForEmail]).toEqual([]);
  });
});

describe('what control flow this compiler will not follow', () => {
  it('refuses a loop with two ways out', () => {
    // The alternatives are duplicating the tail —
    // which records the same step name twice — or a
    // switch that scatters what comes after.
    const result = refusal(
      makeIR({
        name: 'two_exits',
        nodes: [
          TRIGGER,
          FIND_SLOT,
          {
            id: 'route',
            kind: 'branch',
            title: 'Where to?',
            in: 'SlotGrid',
            config: {
              cases: [
                {
                  port: 'again',
                  when: { path: 'requestedSlotFree', op: 'eq', value: false },
                  maxIterations: 3,
                },
                {
                  port: 'book',
                  when: { path: 'requestedSlotFree', op: 'eq', value: true },
                },
              ],
              elsePort: 'other',
            },
          },
          {
            id: 'book_now',
            kind: 'step',
            title: 'Book it now',
            handler: { export: 'bookAppointment' },
            in: 'SlotGrid',
            out: 'Booking',
            config: {},
          },
          {
            id: 'offer_times',
            kind: 'step',
            title: 'Offer other times',
            handler: { export: 'twilioChat' },
            in: 'SlotGrid',
            out: 'ChatPrompt',
            config: {},
          },
        ],
        edges: [
          { from: 'review_started', to: 'find_slot', type: 'BookingReq' },
          { from: 'find_slot', to: 'route', type: 'SlotGrid' },
          {
            from: 'route',
            port: 'again',
            to: 'find_slot',
            type: 'BookingReq',
            back: true,
          },
          { from: 'route', port: 'book', to: 'book_now', type: 'SlotGrid' },
          { from: 'route', port: 'other', to: 'offer_times', type: 'SlotGrid' },
        ],
      }),
    );

    expect(result.nodeId).toBe('route');
    expect(result.message).toContain('one way out');
  });

  it('refuses two wires back to one block', () => {
    // Each case declares its own bound. One loop
    // can only carry one, so honouring the drawing
    // would mean throwing one of the two away and
    // letting a case go round more often than its
    // author allowed.
    const result = refusal(
      makeIR({
        name: 'two_ways_back',
        nodes: [
          TRIGGER,
          FIND_SLOT,
          {
            id: 'first_check',
            kind: 'branch',
            title: 'Anything open?',
            in: 'SlotGrid',
            config: {
              cases: [
                {
                  port: 'again',
                  when: { path: 'requestedSlotFree', op: 'eq', value: false },
                  maxIterations: 3,
                },
              ],
              elsePort: 'on',
            },
          },
          {
            id: 'chat',
            kind: 'step',
            title: 'Text the customer',
            handler: { export: 'twilioChat' },
            in: 'SlotGrid',
            out: 'ChatPrompt',
            config: {},
          },
          {
            id: 'second_check',
            kind: 'branch',
            title: 'Said anything?',
            in: 'ChatPrompt',
            config: {
              cases: [
                {
                  port: 'again',
                  when: { path: 'body', op: 'nonempty' },
                  maxIterations: 7,
                },
              ],
              elsePort: 'done',
            },
          },
          {
            id: 'book_now',
            kind: 'step',
            title: 'Book it now',
            handler: { export: 'bookAppointment' },
            in: 'SlotGrid',
            out: 'Booking',
            config: {},
          },
        ],
        edges: [
          { from: 'review_started', to: 'find_slot', type: 'BookingReq' },
          { from: 'find_slot', to: 'first_check', type: 'SlotGrid' },
          {
            from: 'first_check',
            port: 'again',
            to: 'find_slot',
            type: 'BookingReq',
            back: true,
          },
          { from: 'first_check', port: 'on', to: 'chat', type: 'SlotGrid' },
          { from: 'chat', to: 'second_check', type: 'ChatPrompt' },
          {
            from: 'second_check',
            port: 'again',
            to: 'find_slot',
            type: 'BookingReq',
            back: true,
          },
          {
            from: 'second_check',
            port: 'done',
            to: 'book_now',
            type: 'SlotGrid',
          },
        ],
      }),
    );

    expect(result.nodeId).toBe('second_check');
    expect(result.message).toContain('`first_check`');
    expect(result.message).toContain('one bound');
  });

  it('refuses a block the ways into it disagree about', () => {
    // Both arms bind a value of their own and both
    // wire to the same block, so the drawing names
    // two producers for one input. The types match
    // here, which is the dangerous half: the file
    // compiles and runs on the value from before
    // the branch, and nothing says so.
    const result = refusal(
      makeIR({
        name: 'two_producers',
        nodes: [
          TRIGGER,
          FIND_SLOT,
          {
            id: 'book_appointment',
            kind: 'step',
            title: 'Book it now',
            handler: { export: 'bookAppointment' },
            in: 'SlotGrid',
            out: 'Booking',
            config: {},
          },
          {
            id: 'pick',
            kind: 'branch',
            title: 'Which ledger?',
            in: 'Booking',
            config: {
              cases: [
                { port: 'yes', when: { path: 'bookingId', op: 'nonempty' } },
              ],
              elsePort: 'no',
            },
          },
          {
            id: 'record_a',
            kind: 'transaction',
            title: 'Record it one way',
            handler: { export: 'recordBooking' },
            in: 'Booking',
            out: 'Booking',
            config: {},
          },
          {
            id: 'record_b',
            kind: 'transaction',
            title: 'Record it the other way',
            handler: { export: 'recordBooking' },
            in: 'Booking',
            out: 'Booking',
            config: {},
          },
          {
            id: 'record_final',
            kind: 'transaction',
            title: 'Record it for good',
            handler: { export: 'recordBooking' },
            in: 'Booking',
            out: 'Booking',
            config: {},
          },
        ],
        edges: [
          { from: 'review_started', to: 'find_slot', type: 'BookingReq' },
          { from: 'find_slot', to: 'book_appointment', type: 'SlotGrid' },
          { from: 'book_appointment', to: 'pick', type: 'Booking' },
          { from: 'pick', port: 'yes', to: 'record_a', type: 'Booking' },
          { from: 'pick', port: 'no', to: 'record_b', type: 'Booking' },
          { from: 'record_a', to: 'record_final', type: 'Booking' },
          { from: 'record_b', to: 'record_final', type: 'Booking' },
        ],
      }),
    );

    expect(result.nodeId).toBe('record_final');
    expect(result.message).toContain('`record_a`');
    expect(result.message).toContain('`record_b`');
  });

  it('refuses a document where a block it can reach is never written', () => {
    // A loop whose body nothing wires into leaves
    // the walk with nowhere to carry on, and the
    // block after it would simply be missing from
    // the file. Nothing else would say so: it would
    // compile, run, and quietly skip the work.
    const result = refusal(
      makeIR({
        name: 'stranded',
        nodes: [
          TRIGGER,
          {
            id: 'draft_rounds',
            kind: 'loop',
            title: 'Draft and check',
            config: { minRounds: 1, maxRounds: 2, body: ['find_slot'] },
          },
          FIND_SLOT,
          {
            id: 'wrap_up',
            kind: 'step',
            title: 'Tidy up',
            handler: { export: 'sweepStale' },
            config: {},
          },
        ],
        edges: [
          { from: 'review_started', to: 'draft_rounds', type: 'BookingReq' },
          { from: 'draft_rounds', to: 'wrap_up' },
        ],
      }),
    );

    expect(result.nodeId).toBe('wrap_up');
  });

  it('refuses a block that leaves by more than one wire', () => {
    // Only a branch says which way a run goes. Two
    // wires off a step say both, and a compiler
    // following one would drop work the canvas
    // shows without saying which.
    const result = refusal(
      makeIR({
        name: 'fan_out',
        nodes: [
          TRIGGER,
          FIND_SLOT,
          { id: 'book_now', kind: 'step', title: 'Book it now', in: 'SlotGrid' },
          { id: 'tell_them', kind: 'step', title: 'Tell them', in: 'SlotGrid' },
        ],
        edges: [
          { from: 'review_started', to: 'find_slot', type: 'BookingReq' },
          { from: 'find_slot', to: 'book_now', type: 'SlotGrid' },
          { from: 'find_slot', to: 'tell_them', type: 'SlotGrid' },
        ],
      }),
    );

    expect(result.nodeId).toBe('find_slot');
    expect(result.message).toContain('more than one wire');
  });

  it('refuses a block two ways round the same branch both arrive at', () => {
    // Two of the three ways out meet at `confirm`,
    // which is where the arms are taken to have
    // met again. The third meets them a block
    // later, at `record` — so a walk that has
    // already written `record` once arrives at it
    // again, and writing it twice would run it
    // twice.
    const result = refusal(
      makeIR({
        name: 'reached_twice',
        nodes: [
          TRIGGER,
          FIND_SLOT,
          {
            id: 'route',
            kind: 'branch',
            title: 'What is open?',
            in: 'SlotGrid',
            config: {
              cases: [
                {
                  port: 'free',
                  when: { path: 'requestedSlotFree', op: 'eq', value: true },
                },
                { port: 'offer', when: { path: 'alternatives', op: 'nonempty' } },
              ],
              elsePort: 'none',
            },
          },
          { id: 'confirm', kind: 'step', title: 'Confirm the time' },
          { id: 'apologise', kind: 'step', title: 'Say sorry' },
          { id: 'record', kind: 'step', title: 'Write it down' },
        ],
        edges: [
          { from: 'review_started', to: 'find_slot', type: 'BookingReq' },
          { from: 'find_slot', to: 'route', type: 'SlotGrid' },
          { from: 'route', port: 'free', to: 'confirm' },
          { from: 'route', port: 'offer', to: 'confirm' },
          { from: 'route', port: 'none', to: 'apologise' },
          { from: 'confirm', to: 'record' },
          { from: 'apologise', to: 'record' },
        ],
      }),
    );

    expect(result.nodeId).toBe('record');
    expect(result.message).toContain('more than once');
  });
});
