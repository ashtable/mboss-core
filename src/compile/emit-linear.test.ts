import { join } from 'node:path';

import prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { scanLib } from '../manifest/index.js';
import { ESLINT_CONFIG_MJS } from '../scaffold/templates/dotfiles.js';
import {
  expectGolden,
  fixturesRoot,
  readFixtureJson,
} from '../test-support/fixtures.js';
import { eslintProblems } from '../test-support/lint.js';
import { makeIR, type EdgeSpec, type NodeSpec } from '../test-support/ir.js';
import {
  relativeSpecifiersEndInJs,
  specifiersOf,
} from '../test-support/specifiers.js';
import { expectHouseStyle } from '../test-support/style.js';

import {
  determinismProblems,
  headerProblems,
  registrationProblems,
  stepProblems,
} from './audit.js';
import { compileWorkflow, type CompileResult } from './compile.js';

/**
 * One compiled file per node kind, and the
 * properties every compiled file has.
 *
 * The goldens are the last assertion, never the
 * first: each file below is pinned by named
 * assertions and by the audits before it is
 * compared byte for byte, so a blessing can only
 * lock down the parts nobody wrote a rule for.
 */

const MANIFEST = scanLib(join(fixturesRoot, 'lib'));

const TIMEZONE = 'America/Los_Angeles';

function compile(ir: WorkflowIR): string {
  const result = compileWorkflow({
    ir,
    manifest: MANIFEST,
    timezone: TIMEZONE,
  });

  if (!result.ok) {
    throw new Error(
      `compile failed: ${JSON.stringify(result, null, 2).slice(0, 2000)}`,
    );
  }

  return result.source;
}

/**
 * The other half of `compile`: what comes back
 * when the document is one this compiler refuses.
 *
 * A refusal is an answer rather than a failure. The
 * document is a legal draft, and the message names
 * the block somebody has to go and look at.
 */
function refuse(ir: WorkflowIR): Extract<CompileResult, { ok: false }> {
  const result = compileWorkflow({
    ir,
    manifest: MANIFEST,
    timezone: TIMEZONE,
  });

  if (result.ok) {
    throw new Error(`compile succeeded:\n${result.source}`);
  }

  return result;
}

function workflow(parts: {
  name: string;
  nodes: readonly NodeSpec[];
  edges?: readonly EdgeSpec[];
}): ReturnType<typeof makeIR> {
  return makeIR(parts);
}

const EVENT_TRIGGER = workflow({
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

const MANUAL_TRIGGER = workflow({
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

const SCHEDULE_TRIGGER = workflow({
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
 * A scheduled run with a block that wants the
 * payload the run does not have.
 */
const SCHEDULE_NEEDS_PAYLOAD = workflow({
  name: 'nightly_sweep',
  nodes: [
    {
      id: 'every_night',
      kind: 'trigger',
      title: 'Every night',
      config: { mode: 'schedule', cron: '0 3 * * *' },
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
  edges: [{ from: 'every_night', to: 'parse_request' }],
});

const SCHEDULE_NO_ZONE = workflow({
  name: 'schedule_no_zone',
  nodes: [
    {
      id: 'every_night',
      kind: 'trigger',
      title: 'Every night',
      config: { mode: 'schedule', cron: '0 3 * * *' },
    },
  ],
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

const STEP = workflow({
  name: 'step',
  nodes: retryChain('step'),
  edges: RETRY_EDGES,
});

const API_CALL = workflow({
  name: 'api_call',
  nodes: retryChain('apiCall'),
  edges: RETRY_EDGES,
});

const CODE_STEP = workflow({
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

const TRANSACTION = workflow({
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

const FOR_EACH = workflow({
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
const FOR_EACH_TRANSACTION = workflow({
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
const NAME_COLLISION = workflow({
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

/**
 * A name long enough that the registration cannot
 * be written on one line. Every name the goldens
 * carry is short, so nothing else in this file
 * measures the wide layouts.
 */
const LONG_NAME = workflow({
  name: 'booking_confirmation_flow',
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

const GUARD = { path: 'service', op: 'eq', value: 'groom' } as const;

const GUARDED_CHAIN = workflow({
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
function fixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

const GOLDENS = [
  ['approval_flow', fixture('approval_flow')],
  ['branch_three_ways', fixture('branch_three_ways')],
  ['chat_retry_abort', fixture('chat_retry_abort')],
  ['chat_retry_continue', fixture('chat_retry_continue')],
  ['decision_three_ways', fixture('decision_three_ways')],
  ['decision_yes_no', fixture('decision_yes_no')],
  ['form_intake', fixture('form_intake')],
  ['form_retry', fixture('form_retry')],
  ['groom_booking', fixture('groom_booking')],
  ['review_loop', fixture('review_loop')],
  ['slot_retry_abort', fixture('slot_retry_abort')],
  ['slot_retry_continue', fixture('slot_retry_continue')],
  ['timer_wait', fixture('timer_wait')],
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

describe('an event trigger', () => {
  const source = compile(EVENT_TRIGGER);

  it('takes the payload it declared, by name', () => {
    expect(source).toContain(
      'async function eventTriggerFn(evt: WebhookEvent): Promise<void> {',
    );
  });

  it('exports the descriptor the ingress route reads', () => {
    expect(source).toContain('export const trigger: TriggerDescriptor = {');
    expect(source).toContain("mode: 'event',");
    expect(source).toContain("topic: 'booking.requested',");
    expect(source).toContain("idempotencyKeyPath: 'requestId',");
    expect(source).toContain("requesterEmailPath: 'customer.email',");
  });

  it('checks the two paths it declared, and says so honestly', () => {
    expect(source).toContain(
      'export function checkPayload(payload: unknown): PayloadCheck {',
    );
    expect(source).toContain(
      "return { ok: false, problem: 'the payload is not an object' };",
    );
    expect(source).toContain('const key = event.requestId;');
    expect(source).toContain("problem: 'requestId is missing'");
    expect(source).toContain('const requesterEmail = event.customer?.email;');
    expect(source).toContain("problem: 'customer.email is missing'");
    expect(source).toContain('return { ok: true, key, requesterEmail };');
  });

  it('exports the two wait tables the registry reads', () => {
    expect(source).toContain(
      'export const waits: Record<string, WaitDescriptor> = {};',
    );
    expect(source).toContain('export const eventWaits: EventWait[] = [];');
  });

  it('imports the payload type from the code-behind', () => {
    expect(source).toContain(
      "import type { WebhookEvent } from '../../lib/types.js';",
    );
  });
});

describe('a trigger with no declared paths', () => {
  const source = compile(STEP);

  it('checks the payload is an object and claims nothing else', () => {
    expect(source).toContain(
      'return { ok: true, key: undefined, requesterEmail: undefined };',
    );
    expect(source).not.toContain('const key =');
    expect(source).not.toContain('const requesterEmail =');
  });
});

describe('a manual trigger', () => {
  const source = compile(MANUAL_TRIGGER);

  it('has nothing to check, and takes no argument to check it', () => {
    // Returning ok with both fields undefined is
    // what makes the runs route mint a fresh
    // workflow id rather than derive one.
    expect(source).toContain(
      [
        'export function checkPayload(): PayloadCheck {',
        '  return { ok: true, key: undefined, requesterEmail: undefined };',
        '}',
      ].join('\n'),
    );
  });

  it('exports the descriptor with no topic', () => {
    expect(source).toContain(
      "export const trigger: TriggerDescriptor = { mode: 'manual' };",
    );
  });
});

describe('a schedule trigger', () => {
  const source = compile(SCHEDULE_TRIGGER);

  it('takes the two arguments the SDK hands a scheduled workflow', () => {
    expect(source).toContain(
      [
        'async function scheduleTriggerFn(',
        '  scheduledTime: Date,',
        '  context: unknown,',
        '): Promise<void> {',
      ].join('\n'),
    );
  });

  it('exports a flat schedule descriptor', () => {
    // Flat because `applySchedules` takes them
    // flat; `createSchedule` nests them under
    // `options` and is not what the app calls.
    expect(source).toContain('export const schedule: ScheduleEntry = {');
    expect(source).toContain("scheduleName: 'schedule_trigger',");
    expect(source).toContain('workflowFn: scheduleTrigger,');
    expect(source).toContain("schedule: '0 3 * * *',");
    expect(source).toContain("cronTimezone: 'Europe/Berlin',");
    expect(source).toContain('automaticBackfill: true,');
  });

  it('never emits the deprecated registration forms', () => {
    expect(source).not.toContain('registerScheduled');
    expect(source).not.toContain('crontab');
    expect(source).not.toContain('@DBOS.scheduled');
  });

  it('checks its own bounds, against constants', () => {
    // The SDK's schedule has no start or end, and
    // deleting the schedule to enforce one would
    // not survive the next boot, which reapplies
    // it.
    expect(source).toContain(
      "const SCHEDULE_STARTS = new Date('2026-01-01T00:00:00.000Z');",
    );
    expect(source).toContain(
      "const SCHEDULE_ENDS = new Date('2026-12-31T23:59:59.000Z');",
    );
    expect(source).toContain('if (scheduledTime < SCHEDULE_STARTS) return;');
    expect(source).toContain('if (scheduledTime > SCHEDULE_ENDS) return;');
  });

  it('runs a block whose handler asks it for nothing', () => {
    // A run the clock starts carries no payload,
    // and the SDK's signature binds no parameter
    // to hold one, so the only block a scheduled
    // workflow can run is one that wants nothing.
    expect(source).toContain('async () => sweepStale(),');
    expect(source).not.toContain('evt');
  });

  it('refuses a block that wants a payload the clock cannot give', () => {
    const result = refuse(SCHEDULE_NEEDS_PAYLOAD);

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;

    expect(result.nodeId).toBe('parse_request');
    expect(result.message).toContain('carries no payload');
  });

  it('stamps the requested timezone when the trigger declares none', () => {
    // An absent zone means the process's local
    // one, which would make the schedule depend on
    // where it was deployed.
    const source = compile(SCHEDULE_NO_ZONE);

    expect(source).toContain(`cronTimezone: '${TIMEZONE}',`);
    expect(source).not.toContain('SCHEDULE_STARTS');
  });
});

describe('a step', () => {
  const source = compile(STEP);

  it('writes the schema defaults out when the node carries no retry', () => {
    // The generated file says what it does rather
    // than leaning on a default a reader would
    // have to go and look up.
    expect(source).toContain(
      [
        '  const parseRequestOut = await DBOS.runStep(async () => ' +
          'parseRequest(evt), {',
        "    name: 'parse_request',",
        '    retriesAllowed: true,',
        '    maxAttempts: 3,',
        '    intervalSeconds: 1,',
        '    backoffRate: 2,',
        '  });',
      ].join('\n'),
    );
  });

  it("writes the author's policy when the node carries one", () => {
    expect(source).toContain('maxAttempts: 5,');
    expect(source).toContain('intervalSeconds: 2,');
    expect(source).toContain('backoffRate: 3,');
  });

  it('turns retries off, and says nothing else, for a single attempt', () => {
    // The other three fields are inert when
    // retries are off, and writing them out would
    // suggest they were doing something.
    expect(source).toContain(
      [
        "      name: 'twilio_chat',",
        '      retriesAllowed: false,',
        '    },',
      ].join('\n'),
    );
  });

  it('passes each step its predecessor', () => {
    expect(source).toContain('async () => findSlot(parseRequestOut),');
    expect(source).toContain('async () => twilioChat(findSlotOut),');
  });
});

describe('a block that declares no input', () => {
  it('still hands its handler the value its producer bound', () => {
    // What a block says about its own input does
    // not change how many arguments its handler
    // takes. Calling a one-parameter function with
    // nothing is not a wrong type somewhere in the
    // file — it is a file that does not compile.
    const source = compile(
      workflow({
        name: 'no_declared_input',
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
            config: {},
          },
        ],
        edges: [
          {
            from: 'booking_requested',
            to: 'parse_request',
            type: 'WebhookEvent',
          },
          { from: 'parse_request', to: 'find_slot' },
        ],
      }),
    );

    expect(source).toContain('async () => findSlot(parseRequestOut),');
  });
});

describe('an apiCall', () => {
  it('compiles exactly like a step, plus a comment naming the service', () => {
    // `service` is display and convention only, so
    // it may not change a line of behaviour. The
    // cheapest way to keep the two emitters from
    // drifting is to compare their output.
    const asStep = compile(STEP);
    const asApiCall = compile(API_CALL);

    const stripped = asApiCall
      .split('\n')
      .filter((line) => line.trim() !== '// External service: stripe.')
      .join('\n')
      .replaceAll('api_call', 'step')
      .replaceAll('apiCall', 'step');

    expect(stripped).toBe(asStep);
    expect(asApiCall).toContain('  // External service: stripe.');
  });
});

describe('a codeStep', () => {
  it('compiles like a step and carries no comment of its own', () => {
    const source = compile(CODE_STEP);

    expect(source).toContain(
      'await DBOS.runStep(async () => parseRequest(evt)',
    );
    expect(source).not.toContain('External service');
  });
});

describe('a transaction', () => {
  const source = compile(TRANSACTION);

  it('runs through the datasource, never the global client', () => {
    expect(source).toContain(
      [
        '  const recordBookingOut = await appDb.runTransaction(',
        '    async () => recordBooking(evt),',
        "    { name: 'record_booking' },",
        '  );',
      ].join('\n'),
    );
    expect(source).toContain("import { appDb } from '../app/db.js';");
  });

  it('never reaches for the transaction-scoped client itself', () => {
    // `.client` throws outside a transaction, and
    // what goes inside one is the handler's, not
    // the compiler's.
    expect(source).not.toContain('.client');
  });
});

describe('a forEach', () => {
  const source = compile(FOR_EACH);

  it('settles every item and never takes the process down for one', () => {
    expect(source).toContain('await Promise.allSettled(');
    expect(source).not.toContain('Promise.all(');
  });

  it('registers no queue', () => {
    // A generated app has none, deliberately: the
    // fan-out happens inside the run.
    expect(source).not.toContain('registerQueue');
    expect(source).not.toContain('WorkflowQueue');
  });

  it('chunks at the concurrency the node asked for', () => {
    expect(source).toContain('offset += 4');
    expect(source).toContain('items.slice(offset, offset + 4)');
  });

  it('names each item step by its own position', () => {
    expect(source).toContain('name: `confirm_each[${offset + index}]`,');
  });

  it('fails the run and names the count when items are rejected', () => {
    expect(source).toContain(
      "const failed = settled.filter((r) => r.status === 'rejected');",
    );
    expect(source).toContain('if (failed.length > 0) {');
    expect(source).toContain(
      '`confirm_each: ${failed.length} of ${settled.length} items failed`,',
    );
  });

  it('collects the fulfilled values into the node local', () => {
    expect(source).toContain(
      [
        '  const confirmEachOut = settled.flatMap((r) =>',
        "    r.status === 'fulfilled' ? [r.value] : [],",
        '  );',
      ].join('\n'),
    );
  });

  it('types the settled list by the per-item type the node declares', () => {
    // The node's `out` names what the handler
    // returns for one item; the local it fills is
    // a list of that.
    expect(source).toContain(
      'const settled: PromiseSettledResult<Booking>[] = [];',
    );
  });
});

describe('a run of nodes behind one condition', () => {
  const source = compile(GUARDED_CHAIN);

  it('emits one if block around the whole run', () => {
    // Once, not once per block. A value bound
    // inside one `if` does not narrow inside a
    // second `if` testing the same thing, so a
    // chain emitted block by block would be
    // rejected at its own second block.
    expect(source).toContain("if (parseRequestOut.service === 'groom') {");
    expect(source.split("=== 'groom'")).toHaveLength(2);
  });

  it('keeps the locals inside the block', () => {
    // A value hoisted above the block would not
    // narrow inside a second `if` carrying the
    // same condition, and its consumer would be
    // rejected.
    expect(source).not.toContain('let findSlotOut');
    expect(source).toContain('    const findSlotOut = await DBOS.runStep(');
    expect(source).toContain(
      '    const bookAppointmentOut = await DBOS.runStep(',
    );
  });

  it('refuses a block that reads what a condition put out of scope', () => {
    // A `const` bound inside an `if` is not there
    // outside it. Handing the value to a block
    // that runs unconditionally is not a wrong
    // type somewhere in the file — it is a file
    // that does not compile at all, which neither
    // a golden nor a type name can see coming.
    const result = refuse(
      workflow({
        name: 'guard_escape',
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
            guard: { path: 'service', op: 'exists' },
            config: {},
          },
          {
            id: 'find_slot',
            kind: 'step',
            title: 'Find open slot',
            handler: { export: 'findSlot' },
            config: {},
          },
        ],
        edges: [
          {
            from: 'booking_requested',
            to: 'parse_request',
            type: 'WebhookEvent',
          },
          { from: 'parse_request', to: 'find_slot' },
        ],
      }),
    );

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;

    expect(result.nodeId).toBe('find_slot');
    expect(result.message).toContain('parse_request');
  });

  it('refuses a condition that tests what another condition hid', () => {
    // The `if` is written outside the block it
    // opens, so it may only read what is in scope
    // there. `sweep_stale` asks its handler for
    // nothing, so the condition is the only thing
    // reaching for the value.
    const result = refuse(
      workflow({
        name: 'guard_condition',
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
            guard: { path: 'service', op: 'exists' },
            config: {},
          },
          {
            id: 'sweep_stale',
            kind: 'step',
            title: 'Sweep stale bookings',
            handler: { export: 'sweepStale' },
            guard: GUARD,
            config: {},
          },
        ],
        edges: [
          {
            from: 'booking_requested',
            to: 'parse_request',
            type: 'WebhookEvent',
          },
          { from: 'parse_request', to: 'sweep_stale' },
        ],
      }),
    );

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;

    expect(result.nodeId).toBe('sweep_stale');
    expect(result.message).toContain('parse_request');
  });
});

/**
 * A branch carrying a retry policy of its own.
 *
 * Every branch on disk leaves the schema's defaults
 * in place, so this is the only place the decision
 * step's retry options are measured against
 * something the author wrote.
 */
const DECISION_RETRY = workflow({
  name: 'decision_retry',
  nodes: [
    {
      id: 'claim_filed',
      kind: 'trigger',
      title: 'Claim filed',
      out: 'ExpenseClaim',
      config: { mode: 'event', topic: 'expense.filed' },
    },
    {
      id: 'auto_approve',
      kind: 'branch',
      title: 'Pay it without asking?',
      in: 'ExpenseClaim',
      handler: { export: 'autoApprove' },
      retry: { maxAttempts: 1 },
      config: {
        cases: [
          { port: 'yes', when: { path: '', op: 'eq', value: true } },
          { port: 'no', when: { path: '', op: 'eq', value: false } },
        ],
        elsePort: 'else',
      },
    },
  ],
  edges: [{ from: 'claim_filed', to: 'auto_approve', type: 'ExpenseClaim' }],
});

describe('a branch that runs code of its own', () => {
  const source = compile(fixture('decision_yes_no'));

  it('runs the handler as a step, into a local named for the block', () => {
    expect(source).toContain(
      [
        '  const autoApproveDecision = await DBOS.runStep(' +
          'async () => autoApprove(evt), {',
        "    name: 'auto_approve',",
        '    retriesAllowed: true,',
        '    maxAttempts: 3,',
        '    intervalSeconds: 1,',
        '    backoffRate: 2,',
        '  });',
      ].join('\n'),
    );
  });

  it('tests the decision itself, one case at a time', () => {
    expect(source).toContain('  if (autoApproveDecision === true) {');
    expect(source).toContain('  } else if (autoApproveDecision === false) {');
    expect(source).toContain(['  } else {', '    return;', '  }'].join('\n'));
  });

  it('hands the blocks below the value that was flowing, not the answer', () => {
    // A branch produces nothing, so a block on
    // either arm reads whatever reached the branch.
    expect(source).toContain('async () => payClaim(evt),');
    expect(source).toContain('async () => fileRefusal(evt),');
    expect(source).not.toContain('(autoApproveDecision)');
  });

  it('writes the retry policy the block carries', () => {
    const source = compile(DECISION_RETRY);

    expect(source).toContain(
      [
        '  const autoApproveDecision = await DBOS.runStep(' +
          'async () => autoApprove(evt), {',
        "    name: 'auto_approve',",
        '    retriesAllowed: false,',
        '  });',
      ].join('\n'),
    );
  });
});

describe('a branch deciding between three answers', () => {
  const source = compile(fixture('decision_three_ways'));

  it('chains one case per answer and returns on anything else', () => {
    expect(source).toContain("  if (routeClaimDecision === 'pay') {");
    expect(source).toContain("  } else if (routeClaimDecision === 'refuse') {");
    expect(source).toContain("  } else if (routeClaimDecision === 'hold') {");
    expect(source).toContain(['  } else {', '    return;', '  }'].join('\n'));
  });
});

describe('a loop closed by a decision', () => {
  const abort = compile(fixture('slot_retry_abort'));
  const carryOn = compile(fixture('slot_retry_continue'));

  it('records the round in the decision step’s name', () => {
    // DBOS compares the recorded name at each
    // function id on replay, so two rounds of one
    // block have to record two different names.
    expect(abort).toContain('name: `look_again.r${round}`,');
    expect(carryOn).toContain('name: `look_again.r${round}`,');
  });

  it('leaves the bound out of the case that goes round again', () => {
    // A predicate branch folds the bound into that
    // case so the last round falls through to the
    // wired `else`. A decision's fall-through is a
    // `return`, so folding here would end the run
    // instead of carrying it on; the `while` is
    // what bounds the loop.
    expect(carryOn).toContain(
      ['    if (lookAgainDecision === true) {', '      continue;'].join('\n'),
    );
    expect(carryOn).not.toContain('round < 10 &&');
    expect(carryOn).toContain('} while (round < 10);');
  });

  it('carries the run on past the loop when the rounds run out', () => {
    expect(carryOn).not.toContain('resume');
    expect(carryOn).toContain('async () => bookAppointment(findSlotCarried),');
  });

  it('still throws after the loop where the author asked it to', () => {
    expect(abort).toContain('  if (!resume) {');
    expect(abort).toContain(
      "'look_again: again repeated 10 times without a result.'",
    );
  });

  it('leaves a predicate branch in a loop folding, as it always did', () => {
    // The fold is right for a predicate branch and
    // wrong for a decision, so the two shapes have
    // to be told apart rather than one rule
    // replacing the other.
    expect(compile(fixture('chat_retry_continue'))).toContain(
      "if (round < 10 && readReplyOut.intent === 'reschedule') {",
    );
  });
});

describe('a transaction that fans out', () => {
  const source = compile(FOR_EACH_TRANSACTION);

  it('runs every item through the datasource, not as a plain step', () => {
    // A block the canvas drew as a transaction
    // that quietly stopped being one leaves its
    // handler writing through a client that only
    // exists inside a transaction. Every item then
    // fails, and the run reports the items rather
    // than the missing transaction.
    expect(source).toContain(
      'appDb.runTransaction(async () => confirmSlot(item), {',
    );
    expect(source).toContain("import { appDb } from '../app/db.js';");
    expect(source).not.toContain('DBOS.runStep');
  });

  it('settles every item, the way a fan-out of steps does', () => {
    expect(source).toContain('await Promise.allSettled(');
    expect(source).not.toContain('Promise.all(');
    expect(source).toContain('name: `confirm_each[${offset + index}]`,');
  });

  it('says nothing about retries, which a transaction has no field for', () => {
    // `TransactionConfig` carries an isolation
    // level, a read-only flag and a name. Writing
    // a retry policy there would say something the
    // datasource does not read.
    expect(source).not.toContain('retriesAllowed');
  });
});

describe('a workflow named after a handler it calls', () => {
  const source = compile(NAME_COLLISION);

  it('imports the handler under a name of its own', () => {
    // The registered workflow is exported under
    // the camelCase of the workflow's name, and
    // one file cannot both import and declare the
    // same identifier.
    expect(source).toContain(
      'import { parseRequest as parseRequestHandler } from ' +
        "'../../lib/parseRequest.js';",
    );
    expect(source).toContain('async () => parseRequestHandler(evt),');
  });

  it('still registers under the name the ingress knows', () => {
    expect(source).toContain(
      'export const parseRequest = DBOS.registerWorkflow(parseRequestFn, {',
    );
    expect(source).toContain("name: 'parse_request',");
  });
});

describe('a workflow whose name is long but legal', () => {
  const source = compile(LONG_NAME);
  const path = 'src/workflows/booking_confirmation_flow.workflow.ts';

  it('breaks its registration rather than running past the width', () => {
    // Every golden's name is short enough that the
    // registration fits on one line, so this is
    // the only place the wide layout is measured.
    expect(source).toContain(
      [
        'export const bookingConfirmationFlow = DBOS.registerWorkflow(',
        '  bookingConfirmationFlowFn,',
        '  {',
        "    name: 'booking_confirmation_flow',",
        '  },',
        ');',
      ].join('\n'),
    );
  });

  it('registers itself as a free function at module scope', () => {
    expect(registrationProblems(source, 'booking_confirmation_flow')).toEqual(
      [],
    );
  });

  it('follows the house style', () => {
    expectHouseStyle(source, path);
  });

  it('is already formatted the way prettier would format it', async () => {
    const formatted = await prettier.format(source, {
      parser: 'typescript',
      singleQuote: true,
      semi: true,
      printWidth: 80,
    });

    expect(formatted).toBe(source);
  });
});

describe('every compiled file', () => {
  for (const [name, ir] of GOLDENS) {
    describe(name, () => {
      const source = compile(ir);
      const path = `src/workflows/${name}.workflow.ts`;

      it('opens with the three-line header', () => {
        expect(headerProblems(source, name)).toEqual([]);
      });

      it('registers itself as a free function at module scope', () => {
        expect(registrationProblems(source, name)).toEqual([]);
      });

      it('says what every step does about retries, names and arrows', () => {
        expect(stepProblems(source)).toEqual([]);
      });

      it('does nothing a replay could not reproduce', () => {
        expect(determinismProblems(source)).toEqual([]);
      });

      it('writes relative specifiers node can resolve', () => {
        expect(relativeSpecifiersEndInJs(source)).toEqual([]);
      });

      it('keeps type imports on their own statements', () => {
        // `verbatimModuleSyntax` rejects a mixed
        // import outright.
        for (const line of source.split('\n')) {
          if (!line.startsWith('import ')) continue;
          if (!line.includes('type ')) continue;
          expect(line.startsWith('import type {')).toBe(true);
        }
      });

      it('imports nothing but the SDK, the runtime and the code-behind', () => {
        for (const specifier of specifiersOf(source)) {
          expect(
            specifier === '@dbos-inc/dbos-sdk' ||
              specifier.startsWith('../app/') ||
              specifier.startsWith('../../lib/'),
          ).toBe(true);
        }
      });

      it('follows the house style', () => {
        expectHouseStyle(source, path);
      });

      it('is already formatted the way prettier would format it', async () => {
        const formatted = await prettier.format(source, {
          parser: 'typescript',
          singleQuote: true,
          semi: true,
          printWidth: 80,
        });

        expect(formatted).toBe(source);
      });

      it('matches its golden', () => {
        expectGolden(`golden/compile/${name}.workflow.ts`, source);
      });
    });
  }
});

/**
 * What the lint a generated project ships would
 * say about the directory it is told to skip.
 *
 * `eslint.config.mjs` ignores `src/workflows`, and
 * the comment beside that ignore is the only place
 * its cost is written down: the integration test
 * runs the emitted config, and the emitted config
 * ignores the directory, so nothing else in this
 * suite ever points eslint at compiler output.
 * This does, with the ignore lifted, so the
 * comment is held to what actually comes back.
 */
describe('the lint a generated project ships', () => {
  it('objects to compiler output for two reasons and no third', async () => {
    const files = [
      {
        path: 'eslint.config.mjs',
        contents: ESLINT_CONFIG_MJS.replace(", 'src/workflows/**'", ''),
      },
      ...GOLDENS.map(([name, ir]) => ({
        path: `src/workflows/${name}.workflow.ts`,
        contents: compile(ir),
      })),
    ];
    const problems = await eslintProblems(files);
    const named = problems.map((problem) => /'([^']+)'/.exec(problem)?.[1]);
    const bindings = named.filter((name) => name?.endsWith('Out'));
    const contexts = named.filter((name) => name === 'context');

    // A clean run would mean the exemption costs
    // nothing, which would be the more interesting
    // result and is not this one.
    expect(problems.length).toBeGreaterThan(10);

    // The two the emitted comment names: a step
    // output nothing reads is bound anyway, and a
    // schedule handler is handed a context it does
    // not use. A third kind reaching here is a
    // compiler change the comment has stopped
    // describing.
    expect(bindings.length + contexts.length).toBe(problems.length);
    expect(contexts).toEqual(['context']);

    // And which of the two is the bulk of it. The
    // comment used to name only the context, which
    // is one message of the whole set.
    expect(bindings.length).toBeGreaterThan(contexts.length);
  }, 120_000);
});
