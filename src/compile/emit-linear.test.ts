import { join } from 'node:path';

import prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import { scanLib } from '../manifest/index.js';
import { expectGolden, fixturesRoot } from '../test-support/fixtures.js';
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
import { compileWorkflow } from './compile.js';

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

function compile(ir: ReturnType<typeof makeIR>): string {
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
  ],
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

const GOLDENS = [
  ['event_trigger', EVENT_TRIGGER],
  ['manual_trigger', MANUAL_TRIGGER],
  ['schedule_trigger', SCHEDULE_TRIGGER],
  ['step', STEP],
  ['api_call', API_CALL],
  ['code_step', CODE_STEP],
  ['transaction', TRANSACTION],
  ['for_each', FOR_EACH],
  ['guarded_chain', GUARDED_CHAIN],
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

  it('never names a guarded local from outside the block', () => {
    // A block that declares no input gets no
    // argument, whatever its handler's signature
    // says. Reaching for the value anyway would
    // name a `const` the condition put out of
    // scope, which is not a type error somewhere —
    // it is code that does not compile at all.
    // Validation has already refused the case
    // where a consumer declares an input, so this
    // is the only shape left.
    const escaped = compile(
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

    expect(escaped).toContain('async () => findSlot(),');
    expect(escaped.split('parseRequestOut')).toHaveLength(2);
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
