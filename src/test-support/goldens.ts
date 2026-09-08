import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';

import { readFixtureJson } from './fixtures.js';
import { makeIR, type EdgeSpec, type NodeSpec } from './ir.js';

/**
 * The documents every blessed compiler output
 * under `fixtures/golden/compile/` was compiled
 * from.
 *
 * They live here rather than beside the emitter's
 * own tests because more than one suite needs the
 * pair. The emitter compares its output against
 * the golden; the replay grammar compares what it
 * says a document can record against what the
 * golden records. Both have to be reading one
 * list, or a node kind goes uncovered in one while
 * looking covered in the other.
 *
 * Each constant below is one golden's document.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */

export const EVENT_TRIGGER = makeIR({
  name: 'event_trigger',
  nodes: [
    {
      id: 'booking_requested',
      kind: 'trigger',
      title: 'Booking request',
      out: 'WebhookEvent',
      config: {
        mode: 'event',
        topic: 'booking.requested',
        idempotencyKeyPath: 'requestId',
        requesterEmailPath: 'customer.email',
      },
    },
    {
      id: 'parse_request',
      kind: 'step',
      title: 'Parse request',
      handler: { export: 'parseRequest' },
      in: 'WebhookEvent',
      out: 'BookingReq',
      config: {},
    },
  ],
  edges: [
    { from: 'booking_requested', to: 'parse_request', type: 'WebhookEvent' },
  ],
});

export const MANUAL_TRIGGER = makeIR({
  name: 'manual_trigger',
  nodes: [
    {
      id: 'started_by_hand',
      kind: 'trigger',
      title: 'Started by hand',
      out: 'WebhookEvent',
      config: { mode: 'manual' },
    },
    {
      id: 'parse_request',
      kind: 'step',
      title: 'Parse request',
      handler: { export: 'parseRequest' },
      in: 'WebhookEvent',
      out: 'BookingReq',
      config: {},
    },
  ],
  edges: [
    { from: 'started_by_hand', to: 'parse_request', type: 'WebhookEvent' },
  ],
});

export const SCHEDULE_TRIGGER = makeIR({
  name: 'schedule_trigger',
  nodes: [
    {
      id: 'every_night',
      kind: 'trigger',
      title: 'Every night',
      config: {
        mode: 'schedule',
        cron: '0 3 * * *',
        timezone: 'Europe/Berlin',
        start: '2026-01-01T00:00:00.000Z',
        ends: '2026-12-31T23:59:59.000Z',
      },
    },
    {
      id: 'sweep_stale',
      kind: 'step',
      title: 'Sweep stale bookings',
      handler: { export: 'sweepStale' },
      config: {},
    },
  ],
  edges: [{ from: 'every_night', to: 'sweep_stale' }],
});

/**
 * The three retry shapes, in one file: the
 * schema's defaults written out, a policy of the
 * author's, and a single attempt.
 */
function retryChain(kind: 'step' | 'apiCall'): readonly NodeSpec[] {
  const work = (node: NodeSpec): NodeSpec =>
    kind === 'apiCall'
      ? { ...node, kind: 'apiCall', config: { service: 'stripe' } }
      : { ...node, kind: 'step', config: {} };

  return [
    {
      id: 'booking_requested',
      kind: 'trigger',
      title: 'Booking request',
      out: 'WebhookEvent',
      config: { mode: 'event', topic: 'booking.requested' },
    },
    work({
      id: 'parse_request',
      title: 'Parse request',
      handler: { export: 'parseRequest' },
      in: 'WebhookEvent',
      out: 'BookingReq',
    }),
    work({
      id: 'find_slot',
      title: 'Find open slot',
      handler: { export: 'findSlot' },
      in: 'BookingReq',
      out: 'SlotGrid',
      retry: { maxAttempts: 5, intervalSeconds: 2, backoffRate: 3 },
    }),
    work({
      id: 'twilio_chat',
      title: 'Text the customer',
      handler: { export: 'twilioChat' },
      in: 'SlotGrid',
      out: 'ChatPrompt',
      retry: { maxAttempts: 1 },
    }),
  ];
}

const RETRY_EDGES: readonly EdgeSpec[] = [
  { from: 'booking_requested', to: 'parse_request', type: 'WebhookEvent' },
  { from: 'parse_request', to: 'find_slot', type: 'BookingReq' },
  { from: 'find_slot', to: 'twilio_chat', type: 'SlotGrid' },
];

export const STEP = makeIR({
  name: 'step',
  nodes: retryChain('step'),
  edges: RETRY_EDGES,
});

export const API_CALL = makeIR({
  name: 'api_call',
  nodes: retryChain('apiCall'),
  edges: RETRY_EDGES,
});

export const CODE_STEP = makeIR({
  name: 'code_step',
  nodes: [
    {
      id: 'booking_requested',
      kind: 'trigger',
      title: 'Booking request',
      out: 'WebhookEvent',
      config: { mode: 'event', topic: 'booking.requested' },
    },
    {
      id: 'parse_request',
      kind: 'codeStep',
      title: 'Parse request',
      handler: { export: 'parseRequest' },
      in: 'WebhookEvent',
      out: 'BookingReq',
      config: {},
    },
  ],
  edges: [
    { from: 'booking_requested', to: 'parse_request', type: 'WebhookEvent' },
  ],
});

export const TRANSACTION = makeIR({
  name: 'transaction',
  nodes: [
    {
      id: 'booking_placed',
      kind: 'trigger',
      title: 'Booking placed',
      out: 'Booking',
      config: { mode: 'event', topic: 'booking.placed' },
    },
    {
      id: 'record_booking',
      kind: 'transaction',
      title: 'Record booking',
      handler: { export: 'recordBooking' },
      in: 'Booking',
      out: 'Booking',
      config: {},
    },
  ],
  edges: [{ from: 'booking_placed', to: 'record_booking', type: 'Booking' }],
});

export const FOR_EACH = makeIR({
  name: 'for_each',
  nodes: [
    {
      id: 'slots_found',
      kind: 'trigger',
      title: 'Slots found',
      out: 'SlotGrid',
      config: { mode: 'event', topic: 'slots.found' },
    },
    {
      id: 'confirm_each',
      kind: 'step',
      title: 'Confirm each alternative',
      handler: { export: 'confirmSlot' },
      in: 'SlotGrid',
      out: 'Booking',
      forEach: { itemsPath: 'alternatives', concurrency: 4 },
      config: {},
    },
  ],
  edges: [{ from: 'slots_found', to: 'confirm_each', type: 'SlotGrid' }],
});

/**
 * The same fan-out, drawn as a transaction. Every
 * item writes, so every item needs a transaction of
 * its own.
 */
export const FOR_EACH_TRANSACTION = makeIR({
  name: 'for_each_transaction',
  nodes: [
    {
      id: 'slots_found',
      kind: 'trigger',
      title: 'Slots found',
      out: 'SlotGrid',
      config: { mode: 'event', topic: 'slots.found' },
    },
    {
      id: 'confirm_each',
      kind: 'transaction',
      title: 'Confirm each alternative',
      handler: { export: 'confirmSlot' },
      in: 'SlotGrid',
      out: 'Booking',
      forEach: { itemsPath: 'alternatives', concurrency: 2 },
      config: {},
    },
  ],
  edges: [{ from: 'slots_found', to: 'confirm_each', type: 'SlotGrid' }],
});

/**
 * A workflow named the way one of its handlers is.
 * The file would otherwise import and declare the
 * same identifier.
 */
export const NAME_COLLISION = makeIR({
  name: 'parse_request',
  nodes: [
    {
      id: 'booking_requested',
      kind: 'trigger',
      title: 'Booking request',
      out: 'WebhookEvent',
      config: { mode: 'event', topic: 'booking.requested' },
    },
    {
      id: 'parse_request',
      kind: 'step',
      title: 'Parse request',
      handler: { export: 'parseRequest' },
      in: 'WebhookEvent',
      out: 'BookingReq',
      config: {},
    },
  ],
  edges: [
    { from: 'booking_requested', to: 'parse_request', type: 'WebhookEvent' },
  ],
});

export const GUARD = { path: 'service', op: 'eq', value: 'groom' } as const;

export const GUARDED_CHAIN = makeIR({
  name: 'guarded_chain',
  nodes: [
    {
      id: 'booking_requested',
      kind: 'trigger',
      title: 'Booking request',
      out: 'WebhookEvent',
      config: { mode: 'event', topic: 'booking.requested' },
    },
    {
      id: 'parse_request',
      kind: 'step',
      title: 'Parse request',
      handler: { export: 'parseRequest' },
      in: 'WebhookEvent',
      out: 'BookingReq',
      config: {},
    },
    {
      id: 'find_slot',
      kind: 'step',
      title: 'Find open slot',
      handler: { export: 'findSlot' },
      in: 'BookingReq',
      out: 'SlotGrid',
      guard: GUARD,
      config: {},
    },
    {
      id: 'book_appointment',
      kind: 'step',
      title: 'Book appointment',
      handler: { export: 'bookAppointment' },
      in: 'SlotGrid',
      out: 'Booking',
      guard: GUARD,
      config: {},
    },
  ],
  edges: [
    { from: 'booking_requested', to: 'parse_request', type: 'WebhookEvent' },
    { from: 'parse_request', to: 'find_slot', type: 'BookingReq' },
    { from: 'find_slot', to: 'book_appointment', type: 'SlotGrid' },
  ],
});

/**
 * The control-flow fixtures live on disk rather
 * than being built here: they are whole workflows
 * with branches, loops and joins, and a document
 * that big is easier to read as the document it is.
 */
export function irFixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

/**
 * Every blessed compiler output, by the name its
 * file carries, paired with the document it came
 * from.
 */
export const GOLDENS = [
  ['approval_flow', irFixture('approval_flow')],
  ['branch_three_ways', irFixture('branch_three_ways')],
  ['chat_retry_abort', irFixture('chat_retry_abort')],
  ['chat_retry_continue', irFixture('chat_retry_continue')],
  ['decision_three_ways', irFixture('decision_three_ways')],
  ['decision_yes_no', irFixture('decision_yes_no')],
  ['form_intake', irFixture('form_intake')],
  ['form_retry', irFixture('form_retry')],
  ['groom_booking', irFixture('groom_booking')],
  ['queue_partitioned', irFixture('queue_partitioned')],
  ['review_loop', irFixture('review_loop')],
  ['slot_retry_abort', irFixture('slot_retry_abort')],
  ['slot_retry_continue', irFixture('slot_retry_continue')],
  ['slot_retry_rechecked', irFixture('slot_retry_rechecked')],
  ['timer_wait', irFixture('timer_wait')],
  ['event_trigger', EVENT_TRIGGER],
  ['manual_trigger', MANUAL_TRIGGER],
  ['schedule_trigger', SCHEDULE_TRIGGER],
  ['step', STEP],
  ['api_call', API_CALL],
  ['code_step', CODE_STEP],
  ['transaction', TRANSACTION],
  ['for_each', FOR_EACH],
  ['for_each_transaction', FOR_EACH_TRANSACTION],
  ['guarded_chain', GUARDED_CHAIN],
  ['parse_request', NAME_COLLISION],
] as const;
