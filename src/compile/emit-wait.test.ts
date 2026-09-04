import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import prettier from 'prettier';
import { ts } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import {
  WorkflowIRSchema,
  type Predicate,
  type WaitSource,
  type WorkflowIR,
} from '../ir/index.js';
import { scanLib } from '../manifest/index.js';
import { fixturesRoot, readFixtureJson } from '../test-support/fixtures.js';
import { makeIR, type NodeSpec } from '../test-support/ir.js';

import { stepProblems } from './audit.js';
import { compileWorkflow, type CompileResult } from './compile.js';
import {
  call,
  inlineValue,
  list,
  object,
  source,
  text,
  writeStep,
  writeTimer,
  writeValue,
  writeWait,
  type Emitted,
  type StepSpec,
} from './emit-wait.js';
import { SourceWriter } from './source.js';

/**
 * The statements a run parks on, and the values it
 * hands the runtime, as layout alone.
 *
 * Nothing here knows what a workflow document is.
 * What is checked is the order the statements come
 * in — which is the part a type-check and a golden
 * both agree with while it is wrong — and that the
 * shapes come out already formatted.
 */

function written(write: (writer: SourceWriter) => void): string {
  const writer = new SourceWriter();

  write(writer);
  return writer.toString();
}

const RETRY = [
  'retriesAllowed: true,',
  'maxAttempts: 3,',
  'intervalSeconds: 1,',
  'backoffRate: 2,',
];

function registerStep(nodeId: string, key: string): StepSpec {
  return {
    head: 'await DBOS.runStep',
    call: call(
      'registerWaitCorrelation',
      object([
        { key: 'runId' },
        { key: 'nodeId', value: source(`'${nodeId}'`) },
        { key: 'topic', value: source("'form'") },
        { key: 'key', value: source(key) },
      ]),
    ),
    options: [`name: '${nodeId}.register',`, ...RETRY],
  };
}

function clearStep(nodeId: string): StepSpec {
  return {
    head: 'await DBOS.runStep',
    call: source(`clearWaitCorrelation(runId, '${nodeId}')`),
    options: [`name: '${nodeId}.clear',`, ...RETRY],
  };
}

describe('a value on its way into emitted source', () => {
  it('writes an object on one line when it fits there', () => {
    expect(
      written((writer) => {
        writeValue(
          writer,
          'attach: ',
          object([{ key: 'kind', value: source("'none'") }]),
          ',',
        );
      }),
    ).toBe("attach: { kind: 'none' },\n");
  });

  it('gives every entry a line of its own when it does not', () => {
    expect(
      written((writer) => {
        writeValue(
          writer,
          'attach: ',
          object([
            { key: 'kind', value: source("'artifact'") },
            { key: 'key', value: source('recordBookingOut.deckKey') },
            { key: 'expiresInSeconds', value: source('604800') },
            { key: 'somethingElse', value: source("'to push it over'") },
          ]),
          ',',
        );
      }),
    ).toBe(
      [
        'attach: {',
        "  kind: 'artifact',",
        '  key: recordBookingOut.deckKey,',
        '  expiresInSeconds: 604800,',
        "  somethingElse: 'to push it over',",
        '},',
        '',
      ].join('\n'),
    );
  });

  it('writes an entry with no value of its own as shorthand', () => {
    // `runId: runId` is what a naive renderer
    // writes, and prettier leaves it exactly as
    // written — so the generated file would say
    // something no hand-written file would.
    expect(inlineValue(object([{ key: 'runId' }]))).toBe('{ runId }');
  });

  it('keeps a written string on its line while it fits there', () => {
    expect(
      written((writer) => {
        writeValue(writer, 'subject: ', text('A few details, please'), ',');
      }),
    ).toBe("subject: 'A few details, please',\n");
  });

  it('moves a string too wide for its key onto a line under it', () => {
    // What prettier does with any assignment it
    // has to break, and what a body of authored
    // prose reaches as soon as it is a sentence
    // long.
    expect(
      written((writer) => {
        writeValue(
          writer,
          'const x = ',
          object([
            {
              key: 'bodyMarkdown',
              value: text(
                'Thanks for getting in touch. We can start once you tell ' +
                  'us more.',
              ),
            },
          ]),
          ';',
        );
      }),
    ).toBe(
      [
        'const x = {',
        '  bodyMarkdown:',
        "    'Thanks for getting in touch. We can start once you tell us " +
          "more.',",
        '};',
        '',
      ].join('\n'),
    );
  });

  it('writes a string no line can hold as the sum of ones that fit', () => {
    expect(
      written((writer) => {
        writeValue(
          writer,
          'const x = ',
          object([
            {
              key: 'bodyMarkdown',
              value: text(
                'Thanks for getting in touch. We can start work on this ' +
                  'once you have told us a little more about it.',
              ),
            },
          ]),
          ';',
        );
      }),
    ).toBe(
      [
        'const x = {',
        '  bodyMarkdown:',
        "    'Thanks for getting in touch. We can start work on this once " +
          "you have ' +",
        "    'told us a little more about it.',",
        '};',
        '',
      ].join('\n'),
    );
  });

  it('indents the rest of a sum that stands on its own', () => {
    // A list's member has not already been broken
    // after a key to make room, so prettier
    // indents everything after the first piece
    // under it. Level and indented are different
    // files, and only one of them survives a
    // format.
    expect(
      written((writer) => {
        writeValue(
          writer,
          'const x = ',
          list([
            text(
              'Tell the customer we have everything we need and thank ' +
                'them for their patience',
            ),
          ]),
          ';',
        );
      }),
    ).toBe(
      [
        'const x = [',
        "  'Tell the customer we have everything we need and thank them for " +
          "their ' +",
        "    'patience',",
        '];',
        '',
      ].join('\n'),
    );
  });

  it('keeps every line of what it writes inside the house width', async () => {
    // Both shapes, against the formatter itself
    // rather than against a transcription of what
    // it does. The pieces have to join back to the
    // text somebody wrote, and prettier has to
    // leave the layout alone, or the file stops
    // matching itself on the first format.
    const prose =
      'Thanks for getting in touch about this. We can start work on it ' +
      'once you have told us a little more, and we will come back to you ' +
      'the same day.';
    const shapes = [
      written((writer) => {
        writeValue(
          writer,
          'const x = ',
          object([{ key: 'bodyMarkdown', value: text(prose) }]),
          ';',
        );
      }),
      written((writer) => {
        writeValue(writer, 'const x = ', list([text(prose)]), ';');
      }),
    ];

    for (const shape of shapes) {
      for (const line of shape.split('\n')) {
        expect([...line].length).toBeLessThanOrEqual(80);
      }

      const quoted = [...shape.matchAll(/'([^']*)'/g)].map(
        (match) => match[1] ?? '',
      );
      expect(quoted.join('')).toBe(prose);

      expect(
        await prettier.format(shape, {
          parser: 'typescript',
          singleQuote: true,
          semi: true,
          printWidth: 80,
        }),
      ).toBe(shape);
    }
  });

  it('keeps an empty object and an empty list on their line', () => {
    expect(inlineValue(object([]))).toBe('{}');
    expect(inlineValue(list([]))).toBe('[]');
  });

  it('breaks a list of two objects even where it would fit', () => {
    // Prettier always breaks a list whose members
    // are all objects carrying more than one key,
    // however short they are. A renderer that
    // measured the width alone would emit
    // something prettier immediately rewrites.
    const two = list([
      object([
        { key: 'a', value: source('1') },
        { key: 'b', value: source('2') },
      ]),
      object([
        { key: 'c', value: source('3') },
        { key: 'd', value: source('4') },
      ]),
    ]);

    expect(
      written((writer) => writeValue(writer, 'const x = ', two, ';')),
    ).toBe(
      ['const x = [', '  { a: 1, b: 2 },', '  { c: 3, d: 4 },', '];', ''].join(
        '\n',
      ),
    );
  });

  it('leaves a list of one object alone when it fits', () => {
    const one: Emitted = list([
      object([
        { key: 'a', value: source('1') },
        { key: 'b', value: source('2') },
      ]),
    ]);

    expect(
      written((writer) => writeValue(writer, 'const x = ', one, ';')),
    ).toBe('const x = [{ a: 1, b: 2 }];\n');
  });
});

describe('a step whose callback is one call', () => {
  it('hugs the options onto the call when the head fits', () => {
    expect(
      written((writer) => {
        writeStep(writer, clearStep('await_form'));
      }),
    ).toBe(
      [
        'await DBOS.runStep(async () => ' +
          "clearWaitCorrelation(runId, 'await_form'), {",
        "  name: 'await_form.clear',",
        '  retriesAllowed: true,',
        '  maxAttempts: 3,',
        '  intervalSeconds: 1,',
        '  backoffRate: 2,',
        '});',
        '',
      ].join('\n'),
    );
  });

  it('keeps the arrow whole when only the head is too wide', () => {
    // Two levels in, the hugged form runs past the
    // width but the call itself still fits. The
    // arrow only moves to a line of its own when
    // the call it wraps has to break, and prettier
    // rewrites anything else.
    const writer = new SourceWriter(4);

    writeStep(writer, clearStep('await_details'));

    expect(writer.toString()).toBe(
      [
        '    await DBOS.runStep(',
        "      async () => clearWaitCorrelation(runId, 'await_details'),",
        '      {',
        "        name: 'await_details.clear',",
        '        retriesAllowed: true,',
        '        maxAttempts: 3,',
        '        intervalSeconds: 1,',
        '        backoffRate: 2,',
        '      },',
        '    );',
        '',
      ].join('\n'),
    );
  });

  it('puts the arrow on a line of its own when the call breaks', () => {
    expect(
      written((writer) => {
        writeStep(writer, registerStep('await_form', 'evt.contact.email'));
      }),
    ).toBe(
      [
        'await DBOS.runStep(',
        '  async () =>',
        '    registerWaitCorrelation({',
        '      runId,',
        "      nodeId: 'await_form',",
        "      topic: 'form',",
        '      key: evt.contact.email,',
        '    }),',
        '  {',
        "    name: 'await_form.register',",
        '    retriesAllowed: true,',
        '    maxAttempts: 3,',
        '    intervalSeconds: 1,',
        '    backoffRate: 2,',
        '  },',
        ');',
        '',
      ].join('\n'),
    );
  });
});

/**
 * Where a needle sits in emitted source, asserting
 * that it is there at all.
 *
 * `indexOf` and `findIndex` both answer -1 when
 * the needle is absent, and -1 is below every real
 * index — so an ordering written on a bare one
 * passes when the statement it orders has been
 * deleted, which is the one defect these orderings
 * exist to catch.
 */
function at(source_: string, needle: string): number {
  const found = source_.indexOf(needle);
  expect(found, `${needle} is not in the emitted source`).toBeGreaterThan(-1);

  return found;
}

/** The same, over lines rather than characters. */
function atLine(lines: readonly string[], needle: string): number {
  const found = lines.findIndex((line) => line.includes(needle));
  expect(found, `no line holds ${needle}`).toBeGreaterThan(-1);

  return found;
}

describe('a durable wait', () => {
  const wait = {
    local: 'awaitFormOut',
    type: 'IntakeAnswers',
    topic: 'await_form',
    timeoutSeconds: 604800,
    why: ['Seven days, as seconds.'],
    register: registerStep('await_form', "'await_form'"),
    clear: clearStep('await_form'),
    onNothing: {
      kind: 'throw' as const,
      problem: 'await_form: nothing arrived within 7 days.',
    },
  };

  const source_ = written((writer) => {
    writeWait(writer, wait);
  });

  it('registers before it parks, so nothing arrives to no row', () => {
    // An event landing in the gap would find
    // nothing to look the run up by, and the run
    // would sleep until its timeout with the
    // answer already delivered and dropped.
    expect(at(source_, '.register')).toBeLessThan(at(source_, 'DBOS.recv'));
  });

  it('clears after it wakes and before it asks what arrived', () => {
    // A wait that timed out clears too. Without
    // that the form route's "is this run still
    // waiting?" check reads a row nothing ever
    // deletes, and its 410 can never fire.
    expect(at(source_, 'DBOS.recv')).toBeLessThan(at(source_, '.clear'));
    expect(at(source_, '.clear')).toBeLessThan(at(source_, '=== null'));
  });

  it('calls recv with an options object and never a bare number', () => {
    expect(source_).toContain(
      "const awaitFormOut = await DBOS.recv<IntakeAnswers>('await_form', {",
    );
    expect(source_).toContain('timeoutSeconds: 604800,');
    expect(source_).not.toMatch(/DBOS\.recv<[^>]*>\('[^']*', \d/);
  });

  it('checks the answer against null and never catches anything', () => {
    // recv answers a timeout with null and never
    // throws, so a try around it would be a
    // handler for a case that does not happen.
    // Matched as syntax rather than as words: the
    // comment above the park says "not a catch",
    // and a plain string search would find it.
    expect(source_).toContain('if (awaitFormOut === null) {');
    expect(source_).not.toMatch(/\btry\s*\{/);
    expect(source_).not.toMatch(/\bcatch\s*[({]/);
  });

  it('says why the file names that many seconds', () => {
    expect(source_).toContain('// Seven days, as seconds.');
  });

  it('carries on without the rest of the run when told to', () => {
    const carriesOn = written((writer) => {
      writeWait(writer, { ...wait, onNothing: { kind: 'return' } });
    });

    expect(carriesOn).toContain('if (awaitFormOut === null) return;');
    expect(carriesOn).not.toContain('throw new Error');
  });
});

describe('a wait that sends a reminder', () => {
  const reminder = written((writer) => {
    writeWait(writer, {
      local: 'awaitFormOut',
      type: 'IntakeAnswers',
      topic: 'await_form',
      timeoutSeconds: 604800,
      why: ['Seven days, as seconds.'],
      register: registerStep('await_form', "'await_form'"),
      clear: clearStep('await_form'),
      resend: {
        counter: 'awaitFormResends',
        max: 2,
        step: {
          head: 'await DBOS.runStep',
          call: source('sendNodeEmail(payload)'),
          options: ['name: `await_form.resend.${awaitFormResends}`,', ...RETRY],
        },
      },
      onNothing: {
        kind: 'throw',
        problem: 'await_form: nothing arrived within 7 days.',
      },
    });
  });

  it('parks again after each reminder, up to the count asked for', () => {
    expect(reminder).toContain('let awaitFormResends = 0;');
    expect(reminder).toContain(
      'let awaitFormOut: IntakeAnswers | null = null;',
    );
    expect(reminder).toContain('for (;;) {');
    expect(reminder).toContain('if (awaitFormOut !== null) break;');
    expect(reminder).toContain('if (awaitFormResends >= 2) break;');
    expect(reminder).toContain('awaitFormResends += 1;');
  });

  it('counts the reminder before it sends it', () => {
    // The count is in the step's recorded name, so
    // it has to have moved before the step runs or
    // the first and second reminders record the
    // same one.
    expect(at(reminder, 'awaitFormResends += 1;')).toBeLessThan(
      at(reminder, 'sendNodeEmail'),
    );
  });

  it('still registers once, outside the loop, and clears once after', () => {
    const lines = reminder.split('\n');
    const loop = atLine(lines, 'for (;;) {');
    const end = lines.findIndex((line) => line.trim() === '}');

    expect(atLine(lines, '.register')).toBeLessThan(loop);
    expect(atLine(lines, '.clear')).toBeGreaterThan(end);
  });
});

describe('a wait on the clock', () => {
  const timer = written((writer) => {
    writeTimer(writer, 900);
  });

  it('sleeps in milliseconds, with the seconds already multiplied out', () => {
    expect(timer).toContain('await DBOS.sleep(900000);');
  });

  it('has no topic, no timeout, no reminder and no row to write', () => {
    // A timer has no sender, so there is nobody to
    // correlate with and nothing to remind.
    expect(timer).not.toContain('DBOS.recv');
    expect(timer).not.toContain('WaitCorrelation');
    expect(timer).not.toContain('timeoutSeconds');
    expect(timer).not.toContain('for (;;)');
  });

  it('says why the wake-up survives a restart', () => {
    expect(timer).toContain('// Durable');
    expect(timer).toContain('// 900 seconds, as milliseconds.');
  });
});

/**
 * The same shapes, compiled out of real documents.
 *
 * The layout above is checked with no workflow in
 * sight; below is where a wait, an email and an
 * approval are read out of the IR and turned into
 * the statements that run them.
 */

const MANIFEST = scanLib(join(fixturesRoot, 'lib'));

/** The runtime tree every project is made from. */
const scaffoldRoot = resolve(import.meta.dirname, '../scaffold');

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

function refuse(ir: WorkflowIR): Extract<CompileResult, { ok: false }> {
  const result = compileWorkflow({
    ir,
    manifest: MANIFEST,
    timezone: TIMEZONE,
  });

  if (result.ok) throw new Error(`compile succeeded:\n${result.source}`);

  return result;
}

function fixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

/** A trigger every small document below starts at. */
/**
 * The topic a form wait registers under, read out
 * of the registration the emitter wrote.
 */
function formTopicOf(written: string): string {
  const registration = /nodeId: 'await_details',\n\s*topic: '([^']+)'/.exec(
    written,
  );

  return registration?.[1] ?? '';
}

const CLAIM_FILED: NodeSpec = {
  id: 'claim_filed',
  kind: 'trigger',
  title: 'Claim filed',
  out: 'ExpenseClaim',
  config: {
    mode: 'event',
    topic: 'expense.filed',
    requesterEmailPath: 'submitter.email',
  },
};

describe('a wait for a form', () => {
  const written_ = compile(fixture('form_intake'));

  it('binds the run id once, before anything needs it', () => {
    expect(written_).toContain('const runId = DBOS.workflowID;');
    expect(written_).toContain('if (runId === undefined) {');
    expect(written_.split('DBOS.workflowID')).toHaveLength(2);
  });

  it('reads the requesting address by the path the trigger declared', () => {
    expect(written_).toContain('const requesterEmail = evt.contact?.email;');
  });

  it('registers under the form topic, keyed by the waiting node', () => {
    // One mechanism for both sources rather than a
    // second one invented for forms: every run
    // waiting on this node registers the same key,
    // and the form link carries the run. The topic
    // is namespaced because the other source's is
    // whatever its author typed.
    expect(written_).toContain("topic: 'mboss.form',");
    expect(written_).toContain("key: 'await_details',");
  });

  it('scopes the emailed token to the wait, not to the email', () => {
    // The page a token opens is looked up in the
    // module's waits map. A token scoped to the
    // email would resolve to no wait at all and
    // serve a 400 on a link that is perfectly
    // valid. Asserted as the attachment rather
    // than line by line, because the wait's own id
    // appears in the table below either way.
    expect(written_).toContain(
      [
        '        attach: {',
        "          kind: 'form',",
        "          nodeId: 'await_details',",
      ].join('\n'),
    );
  });

  it('lets the link last exactly as long as the wait it opens', () => {
    // Three days, because that is what this wait
    // set. A link that died first would leave a
    // run parked on a page nobody can open.
    expect(written_).toContain('          expiresInSeconds: 259200,');
    expect(written_).toContain('timeoutSeconds: 259200,');
  });

  it('flattens a conditional field to the answer it watches', () => {
    expect(written_).toContain(
      "showIf: { fieldId: 'urgent', op: 'eq', value: true }",
    );
  });

  it('answers the two optional field flags rather than skipping them', () => {
    // Both are optional in the IR and required by
    // the runtime: one `?? false` here beats one
    // at every point that reads them.
    expect(written_).toContain("id: 'name',");
    expect(written_).toContain('required: true,');
    expect(written_).toContain('multiple: false,');
  });

  it('names the wait in the table the form route looks it up in', () => {
    expect(written_).toContain(
      'export const waits: Record<string, WaitDescriptor> = {',
    );
    expect(written_).toContain('await_details: {');
    expect(written_).toContain("page: 'form',");
    expect(written_).toContain("downstream: ['Record the intake'],");
  });

  it('lists no event wait, because nothing outside sends to it', () => {
    expect(written_).toContain('export const eventWaits: EventWait[] = [];');
  });
});

describe('a wait for an event', () => {
  const written_ = compile(fixture('groom_booking'));

  it('correlates on the value the wait was told to read', () => {
    // Asserted as the whole registration rather
    // than line by line: the topic also appears in
    // the event-wait table below, and a line-by-line
    // check would pass on that one while the
    // registration named something else.
    expect(written_).toContain(
      [
        '        registerWaitCorrelation({',
        '          runId,',
        "          nodeId: 'await_reply',",
        "          topic: 'twilio.reply',",
        '          key: twilioChatOut.to,',
        '        }),',
      ].join('\n'),
    );
  });

  it('tells the ingress route which topic wakes it, and by what', () => {
    expect(written_).toContain(
      "{ nodeId: 'await_reply', topic: 'twilio.reply', " +
        "correlationPath: 'from' },",
    );
  });

  it('serves no page, so it is in neither table twice', () => {
    expect(written_).toContain(
      'export const waits: Record<string, WaitDescriptor> = {};',
    );
  });

  it('multiplies the days it was given out into seconds', () => {
    expect(written_).toContain('timeoutSeconds: 172800,');
    expect(written_).toContain('// 2 days, as seconds.');
  });

  it('carries the round into every step name inside the loop', () => {
    expect(written_).toContain('name: `await_reply.r${round}.register`,');
    expect(written_).toContain('name: `await_reply.r${round}.clear`,');
  });
});

describe('a wait that names no limit of its own', () => {
  const written_ = compile(
    makeIR({
      name: 'no_limit',
      nodes: [
        CLAIM_FILED,
        {
          id: 'await_decision',
          kind: 'durableWait',
          title: 'Wait for a decision',
          out: 'ExpenseClaim',
          config: {
            source: {
              kind: 'event',
              topic: 'expense.decided',
              correlationPath: 'claimId',
              correlateWith: 'claimId',
            },
            onTimeout: 'abort',
          },
        },
      ],
      edges: [
        { from: 'claim_filed', to: 'await_decision', type: 'ExpenseClaim' },
      ],
    }),
  );

  it('waits seven days rather than the minute the SDK would', () => {
    // recv with no timeout returns null after
    // sixty seconds, which would abort a
    // human-in-the-loop wait a minute after the
    // email went out.
    expect(written_).toContain('timeoutSeconds: 604800,');
    expect(written_).not.toMatch(/DBOS\.recv<[^>]*>\('[^']*'\)/);
  });

  it('says in the file why it is seven days', () => {
    // Unwrapped before it is read: the comment is
    // hard-wrapped to the house width, so the
    // sentence it makes is spread over four lines.
    const prose = written_.replaceAll(/\n\s*\/\/ /g, ' ');

    expect(written_).toContain('// Seven days, as seconds.');
    expect(prose).toContain('This wait set no limit of its own');
  });
});

describe('an event wait that claims the name forms register under', () => {
  const written_ = compile(
    makeIR({
      name: 'topic_clash',
      nodes: [
        CLAIM_FILED,
        {
          id: 'await_decision',
          kind: 'durableWait',
          title: 'Wait for a decision',
          out: 'ExpenseClaim',
          config: {
            source: {
              kind: 'event',
              // A forms provider's webhook, named
              // the obvious thing. `topic` is a
              // plain string in the schema, so
              // nothing stops an author writing
              // this.
              topic: 'form',
              correlationPath: 'claimId',
              correlateWith: 'claimId',
            },
            onTimeout: 'abort',
          },
        },
      ],
      edges: [
        { from: 'claim_filed', to: 'await_decision', type: 'ExpenseClaim' },
      ],
    }),
  );

  it('keeps the topic the author asked for', () => {
    expect(written_).toContain("topic: 'form',");
    expect(written_).toContain(
      "{ nodeId: 'await_decision', topic: 'form', " +
        "correlationPath: 'claimId' },",
    );
  });

  it('does not land in the namespace every form wait registers in', () => {
    // Both kinds write into one (topic, key) table
    // and the ingress route resolves a delivery by
    // that pair alone — no column says which
    // mechanism wrote the row. So a form wait
    // registering under a bare `form` would put a
    // webhook payload on a run parked on a page,
    // whenever the correlation value happened to
    // equal a wait's node id.
    expect(formTopicOf(compile(fixture('form_intake')))).not.toBe('form');
  });
});

describe('a wait on the clock alone', () => {
  const written_ = compile(fixture('timer_wait'));

  it('sleeps for the seconds it was given, in milliseconds', () => {
    expect(written_).toContain('await DBOS.sleep(900000);');
  });

  it('parks on nothing, correlates with nothing, reminds nobody', () => {
    expect(written_).not.toContain('DBOS.recv');
    expect(written_).not.toContain('WaitCorrelation');
    expect(written_).not.toContain('timeoutSeconds');
    expect(written_).not.toContain('for (;;)');
  });

  it('needs no run id, because nothing it does is addressed to a run', () => {
    expect(written_).not.toContain('DBOS.workflowID');
  });

  it('lets the value flowing into it flow past it', () => {
    // A timer produces nothing, so the block after
    // one reads whatever the block before it
    // produced.
    expect(written_).toContain('async () => recordBooking(evt),');
  });
});

describe('a wait that sends a reminder, inside a loop', () => {
  const written_ = compile(fixture('form_retry'));

  it('names each reminder by its round and its count', () => {
    // Without the round, the first reminder of
    // round one and the first of round two both
    // record one name, and every recovery after
    // the second round fails.
    expect(written_).toContain(
      'name: `await_details.r${round}.resend.${awaitDetailsResends}`,',
    );
  });

  it('records no two steps under one name', () => {
    expect(stepProblems(written_)).toEqual([]);
  });

  it('sends the same email the wait was opened by', () => {
    // Twice: once when the run first asks, and
    // once from inside the reminder loop.
    expect(written_.split('sendNodeEmail({')).toHaveLength(3);
  });
});

describe('an email', () => {
  const written_ = compile(fixture('groom_booking'));

  it('mints nothing itself, and hands the runtime what to send', () => {
    // The link's issued and expiry times come from
    // the clock, so a workflow body that minted
    // one would produce a different token on every
    // replay. sendNodeEmail mints inside the step.
    expect(written_).toContain('sendNodeEmail({');
    expect(written_).not.toContain('mintFormLink');
    expect(written_).not.toContain('mintArtifactLink');
  });

  it('writes to whoever asked for the run, by the local at the top', () => {
    expect(written_).toContain('to: requesterEmail,');
  });

  it('says which retries are worth making', () => {
    expect(written_).toContain('shouldRetry: isTransientSendFailure,');
    expect(written_).toContain(
      "import { isTransientSendFailure } from '../app/mailer.js';",
    );
  });

  it('carries nothing to attach when the author attached nothing', () => {
    expect(written_).toContain("attach: { kind: 'none' },");
    expect(written_).toContain('downstream: [],');
  });
});

describe('an email carrying a link to something stored', () => {
  const written_ = compile(fixture('approval_flow'));

  it('resolves the path into the value the block produced', () => {
    expect(written_).toContain("kind: 'artifact',");
    expect(written_).toContain('key: payClaimOut.receiptKey,');
  });

  it('gives the link the seven days the token type allows', () => {
    expect(written_).toContain('expiresInSeconds: 604800,');
  });
});

describe('an email whose form nothing waits on', () => {
  it('is refused by name rather than compiled into a dead link', () => {
    const result = refuse(
      makeIR({
        name: 'orphan_form',
        nodes: [
          CLAIM_FILED,
          {
            id: 'ask_something',
            kind: 'emailSend',
            title: 'Ask something',
            config: {
              to: 'ops@example.com',
              subject: 'A question',
              bodyMarkdown: 'Please answer.',
              attach: {
                type: 'form',
                form: {
                  fields: [{ id: 'answer', label: 'Answer', type: 'text' }],
                },
              },
            },
          },
        ],
        edges: [{ from: 'claim_filed', to: 'ask_something' }],
      }),
    );

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;

    expect(result.nodeId).toBe('ask_something');
    expect(result.message).toContain('ask_something');
  });
});

describe('a conditional field the page could not evaluate', () => {
  function withCondition(showIf: Predicate): WorkflowIR {
    return makeIR({
      name: 'bad_condition',
      nodes: [
        CLAIM_FILED,
        {
          id: 'ask_something',
          kind: 'emailSend',
          title: 'Ask something',
          config: {
            to: 'ops@example.com',
            subject: 'A question',
            bodyMarkdown: 'Please answer.',
            attach: {
              type: 'form',
              form: {
                fields: [
                  { id: 'urgent', label: 'Urgent?', type: 'yesNo' },
                  { id: 'why', label: 'Why?', type: 'textarea', showIf },
                ],
              },
            },
          },
        },
        {
          id: 'await_answer',
          kind: 'durableWait',
          title: 'Wait for the answer',
          out: 'ExpenseClaim',
          config: {
            source: { kind: 'form', email: 'ask_something' },
            onTimeout: 'abort',
          },
        },
      ],
      edges: [
        { from: 'claim_filed', to: 'ask_something' },
        { from: 'ask_something', to: 'await_answer' },
      ],
    });
  }

  it('refuses a path that reaches past the answers themselves', () => {
    // A form's answers are a flat map of field id
    // to value. There is nothing for a deeper path
    // to address, and the page evaluates the
    // condition in a browser with only that map.
    const result = refuse(
      withCondition({ path: 'urgent.reason', op: 'exists' }),
    );

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;
    expect(result.message).toContain('why');
  });

  it('refuses a field that watches one asked after it', () => {
    const result = refuse(withCondition({ path: 'later', op: 'exists' }));

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;
    expect(result.message).toContain('why');
  });

  it('refuses a comparison against something that is not one answer', () => {
    // The catalog lets a predicate compare against
    // any JSON, and the page compares one answer
    // to one value in a browser. There is nothing
    // for null, a list or an object to mean there,
    // and a project that emitted one would fail
    // its own type-check naming a type nobody
    // wrote.
    for (const value of [null, [1, 2], { a: 1 }]) {
      const result = refuse(withCondition({ path: 'urgent', op: 'eq', value }));

      expect(result.reason).toBe('UNSUPPORTED');
      if (result.reason !== 'UNSUPPORTED') continue;
      expect(result.nodeId).toBe('ask_something');
      expect(result.message).toContain('why');
    }
  });

  it('compiles every operator the page knows how to evaluate', () => {
    // The page's own script handles all eight, and
    // the compiler passes the operator through
    // verbatim. What this pins is that it passes
    // *every* one through: an operator the
    // compiler quietly dropped would render a
    // field that is always shown.
    const operators = [
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'exists',
      'nonempty',
    ] as const;

    for (const op of operators) {
      const compiled = compile(withCondition({ path: 'urgent', op }));

      expect(compiled).toContain(`showIf: { fieldId: 'urgent', op: '${op}' },`);
    }
  });

  it('compiles a comparison against each kind of answer there is', () => {
    for (const value of ['yes', 3, true]) {
      const source_ = compile(
        withCondition({ path: 'urgent', op: 'eq', value }),
      );

      expect(source_).toContain(
        `showIf: { fieldId: 'urgent', op: 'eq', value: ${JSON.stringify(
          value,
        ).replaceAll('"', "'")} },`,
      );
    }
  });
});

describe('a reminder the author did not size', () => {
  function reminding(extra: Record<string, unknown>): WorkflowIR {
    return makeIR({
      name: 'unsized_reminder',
      nodes: [
        CLAIM_FILED,
        {
          id: 'ask_manager',
          kind: 'emailSend',
          title: 'Ask the manager',
          config: {
            to: 'ops@example.com',
            subject: 'A question',
            bodyMarkdown: 'Please answer.',
            attach: {
              type: 'form',
              form: {
                fields: [{ id: 'answer', label: 'Answer', type: 'text' }],
              },
            },
          },
        },
        {
          id: 'await_manager',
          kind: 'durableWait',
          title: 'Wait for the manager',
          out: 'ExpenseClaim',
          config: {
            source: { kind: 'form', email: 'ask_manager' },
            onTimeout: 'resend',
            ...extra,
          },
        },
      ],
      edges: [
        { from: 'claim_filed', to: 'ask_manager', type: 'ExpenseClaim' },
        { from: 'ask_manager', to: 'await_manager' },
      ],
    });
  }

  it('sends one reminder, which is the fewest that means anything', () => {
    // Left open, a reminder loop is a run that
    // never ends. One is the smallest number that
    // makes "remind them" mean something and still
    // lets the run finish.
    expect(compile(reminding({}))).toContain('if (awaitManagerResends >= 1)');
  });

  it('fails the run when the reminders ran out, unless told otherwise', () => {
    expect(compile(reminding({}))).toContain(
      "throw new Error('await_manager: nothing arrived within 7 days.');",
    );
  });

  it('stops the run quietly when the author asked it to carry on', () => {
    // "Carry on" cannot mean running the blocks
    // below: there is no answer to give them and
    // every one of them said what it expects. It
    // means this run is done.
    const written_ = compile(reminding({ afterMax: 'continue' }));

    expect(written_).toContain('if (awaitManagerOut === null) return;');
    expect(written_).not.toContain('nothing arrived within');
  });
});

describe('a reminder with nothing to resend', () => {
  function resending(waitOn: WaitSource): WorkflowIR {
    return makeIR({
      name: 'nothing_to_resend',
      nodes: [
        CLAIM_FILED,
        {
          id: 'await_decision',
          kind: 'durableWait',
          title: 'Wait for a decision',
          out: 'ExpenseClaim',
          config: { source: waitOn, onTimeout: 'resend', maxResends: 2 },
        },
      ],
      edges: [
        { from: 'claim_filed', to: 'await_decision', type: 'ExpenseClaim' },
      ],
    });
  }

  it('refuses a reminder on a wait for an event', () => {
    const result = refuse(
      resending({
        kind: 'event',
        topic: 'expense.decided',
        correlationPath: 'claimId',
        correlateWith: 'claimId',
      }),
    );

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;
    expect(result.nodeId).toBe('await_decision');
  });

  it('refuses a reminder on a wait for the clock', () => {
    const result = refuse(resending({ kind: 'timer', seconds: 60 }));

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;
    expect(result.nodeId).toBe('await_decision');
  });
});

describe('an approval', () => {
  const written_ = compile(fixture('approval_flow'));

  it('asks, registers, parks, clears, and only then reads the answer', () => {
    const order = [
      "name: 'manager_ok.ask',",
      "name: 'manager_ok.register',",
      "await DBOS.recv<ApprovalReply>('manager_ok', {",
      "name: 'manager_ok.clear',",
      'if (managerOkOut === null) {',
      'if (managerOkOut.approved === true) {',
    ].map((needle) => written_.indexOf(needle));

    expect(order).not.toContain(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('mints an ordinary form token, scoped to itself', () => {
    // No new token type and no new wait primitive:
    // which page a link opens is settled by the
    // module's waits table, never by the token.
    // The link lasts exactly as long as the wait,
    // so nobody meets a dead link on a decision
    // still open.
    expect(written_).toContain(
      [
        '        attach: {',
        "          kind: 'approval',",
        "          nodeId: 'manager_ok',",
        '          expiresInSeconds: 345600,',
        '        },',
      ].join('\n'),
    );
    expect(written_).toContain('timeoutSeconds: 345600,');
  });

  it('says what the email says, in words a reader can see', () => {
    expect(written_).toContain("subject: 'Approve this expense',");
    expect(written_).toContain(
      "bodyMarkdown: 'Please take a look when you can.',",
    );
  });

  it('tells the person what happens next, from where the arms meet', () => {
    // The blocks on the arm they did not take are
    // not what happens next.
    expect(written_).toContain("downstream: ['Close the claim'],");
    expect(written_).not.toContain("'Pay the claim', 'Close the claim'");
  });

  it('serves the approval page, with no form fields of its own', () => {
    expect(written_).toContain("page: 'approval',");
    expect(written_).toContain('fields: [],');
  });

  it('tells the submitted page the same thing the email did', () => {
    // The waits table is what the page rendered
    // after a decision reads, and it is the second
    // place the join-onward titles have to be
    // right. The email's copy of them is asserted
    // above; without this one, widening either
    // list is caught by nothing but the golden.
    expect(written_).toContain(
      [
        'export const waits: Record<string, WaitDescriptor> = {',
        '  manager_ok: {',
        "    nodeId: 'manager_ok',",
        "    title: 'Manager decides',",
        "    page: 'approval',",
        '    fields: [],',
        "    downstream: ['Close the claim'],",
      ].join('\n'),
    );
  });

  it('takes both ways out of the decision', () => {
    expect(written_).toContain('async () => payClaim(evt),');
    expect(written_).toContain('async () => fileRefusal(evt),');
  });
});

describe('an approval with the two optional fields left out', () => {
  function approval(config: Record<string, unknown>): WorkflowIR {
    return makeIR({
      name: 'bare_approval',
      title: 'Bare approval',
      nodes: [
        CLAIM_FILED,
        {
          id: 'manager_ok',
          kind: 'approval',
          title: 'Manager decides',
          config: { to: 'ops@example.com', ...config },
        },
        {
          id: 'pay_it',
          kind: 'step',
          title: 'Pay it',
          handler: { export: 'closeClaim' },
          config: {},
        },
        {
          id: 'drop_it',
          kind: 'step',
          title: 'Drop it',
          handler: { export: 'closeClaim' },
          config: {},
        },
      ],
      edges: [
        { from: 'claim_filed', to: 'manager_ok', type: 'ExpenseClaim' },
        { from: 'manager_ok', port: 'approved', to: 'pay_it' },
        { from: 'manager_ok', port: 'rejected', to: 'drop_it' },
      ],
    });
  }

  const written_ = compile(approval({}));

  it('writes a subject rather than sending one with none', () => {
    // An empty subject line is a bug that only
    // shows up in somebody's inbox.
    expect(written_).toContain("subject: 'Approval needed: Manager decides',");
  });

  it('writes a sentence rather than an empty message', () => {
    expect(written_).toContain(
      "bodyMarkdown: 'Bare approval is waiting on your decision.',",
    );
  });

  it('shows nothing after a decision whose arms never meet again', () => {
    expect(written_).toContain('downstream: [],');
  });

  it('waits the same seven days any other wait with no limit does', () => {
    expect(written_).toContain('timeoutSeconds: 604800,');
  });
});

/**
 * The claim the word "sugar" makes, checked.
 *
 * An approval is one block on the canvas and three
 * constructs in the file. The only way to show that
 * is to write the three out by hand over the same
 * data and compare what each compiles to — and to
 * compare the statements rather than the text,
 * since the names differ by construction.
 */

const SUBJECT = 'Approve this expense';
const MESSAGE = 'Please take a look when you can.';

/** Every statement of the workflow function, as its
 *  kind and what it calls. */
function shapeOf(text: string): string[] {
  const file = ts.createSourceFile('w.ts', text, ts.ScriptTarget.ES2022, true);
  const shapes: string[] = [];

  const callsIn = (node: ts.Node): string[] => {
    const found: string[] = [];
    const walk = (each: ts.Node): void => {
      if (ts.isCallExpression(each)) found.push(each.expression.getText(file));
      ts.forEachChild(each, walk);
    };

    walk(node);
    return found;
  };

  const statementsOf = (node: ts.Statement): readonly ts.Statement[] =>
    ts.isBlock(node) ? node.statements : [node];

  // Named here rather than taken from
  // `SyntaxKind`, whose reverse lookup answers with
  // whichever alias sorts first — a variable
  // statement comes back as `FirstStatement`.
  const labelOf = (statement: ts.Statement): string => {
    if (ts.isVariableStatement(statement)) return 'const';
    if (ts.isExpressionStatement(statement)) return 'call';
    if (ts.isThrowStatement(statement)) return 'throw';
    if (ts.isReturnStatement(statement)) return 'return';
    if (ts.isBreakStatement(statement)) return 'break';
    if (ts.isContinueStatement(statement)) return 'continue';
    if (ts.isForStatement(statement)) return 'for';
    if (ts.isDoStatement(statement)) return 'do';

    return ts.SyntaxKind[statement.kind] ?? 'statement';
  };

  const block = (statements: readonly ts.Statement[], depth: number): void => {
    const pad = '  '.repeat(depth);

    for (const statement of statements) {
      if (ts.isIfStatement(statement)) {
        shapes.push(`${pad}if`);
        block(statementsOf(statement.thenStatement), depth + 1);

        if (statement.elseStatement === undefined) continue;
        shapes.push(`${pad}else`);
        block(statementsOf(statement.elseStatement), depth + 1);
        continue;
      }

      if (ts.isForStatement(statement) || ts.isDoStatement(statement)) {
        shapes.push(`${pad}${labelOf(statement)}`);
        block(statementsOf(statement.statement), depth + 1);
        continue;
      }

      shapes.push(
        [`${pad}${labelOf(statement)}`, ...callsIn(statement)]
          .join(' ')
          .trimEnd(),
      );
    }
  };

  const fn = file.statements.find((each) => ts.isFunctionDeclaration(each));

  if (fn === undefined || !ts.isFunctionDeclaration(fn) || !fn.body) {
    throw new Error('no workflow function');
  }

  block(fn.body.statements, 0);
  return shapes;
}

/** The two arms and where they meet, shared by
 *  both spellings below. */
const DECISION_TAIL: readonly NodeSpec[] = [
  {
    id: 'pay_claim',
    kind: 'step',
    title: 'Pay the claim',
    handler: { export: 'payClaim' },
    in: 'ExpenseClaim',
    out: 'Payment',
    config: {},
  },
  {
    id: 'file_refusal',
    kind: 'step',
    title: 'File the refusal',
    handler: { export: 'fileRefusal' },
    in: 'ExpenseClaim',
    out: 'Refusal',
    config: {},
  },
  {
    id: 'close_claim',
    kind: 'step',
    title: 'Close the claim',
    handler: { export: 'closeClaim' },
    config: {},
  },
];

const AS_APPROVAL = makeIR({
  name: 'as_approval',
  title: 'Expense approval',
  nodes: [
    CLAIM_FILED,
    {
      id: 'manager_ok',
      kind: 'approval',
      title: 'Manager decides',
      config: {
        to: 'ops@example.com',
        subject: SUBJECT,
        message: MESSAGE,
        timeoutDays: 4,
      },
    },
    ...DECISION_TAIL,
  ],
  edges: [
    { from: 'claim_filed', to: 'manager_ok', type: 'ExpenseClaim' },
    { from: 'manager_ok', port: 'approved', to: 'pay_claim' },
    { from: 'manager_ok', port: 'rejected', to: 'file_refusal' },
    { from: 'pay_claim', to: 'close_claim' },
    { from: 'file_refusal', to: 'close_claim' },
  ],
});

const BY_HAND = makeIR({
  name: 'by_hand',
  title: 'Expense approval',
  nodes: [
    CLAIM_FILED,
    {
      id: 'ask_manager',
      kind: 'emailSend',
      title: 'Ask the manager',
      config: {
        to: 'ops@example.com',
        subject: SUBJECT,
        bodyMarkdown: MESSAGE,
        attach: {
          type: 'form',
          form: {
            fields: [{ id: 'approved', label: 'Approve?', type: 'yesNo' }],
          },
        },
      },
    },
    {
      id: 'await_manager',
      kind: 'durableWait',
      title: 'Wait for the manager',
      // The claim rather than a decision type: the
      // approval hands its arms the value that was
      // already flowing, so this is what makes the
      // two spellings read the same value.
      out: 'ExpenseClaim',
      config: {
        source: { kind: 'form', email: 'ask_manager' },
        timeoutDays: 4,
        onTimeout: 'abort',
      },
    },
    {
      id: 'decide',
      kind: 'branch',
      title: 'Approved?',
      in: 'ExpenseClaim',
      config: {
        cases: [
          {
            port: 'approved',
            when: { path: 'approved', op: 'eq', value: true },
          },
        ],
        elsePort: 'rejected',
      },
    },
    ...DECISION_TAIL,
  ],
  edges: [
    { from: 'claim_filed', to: 'ask_manager', type: 'ExpenseClaim' },
    { from: 'ask_manager', to: 'await_manager' },
    { from: 'await_manager', to: 'decide', type: 'ExpenseClaim' },
    { from: 'decide', port: 'approved', to: 'pay_claim' },
    { from: 'decide', port: 'rejected', to: 'file_refusal' },
    { from: 'pay_claim', to: 'close_claim' },
    { from: 'file_refusal', to: 'close_claim' },
  ],
});

describe('an approval beside the three blocks it is sugar for', () => {
  it('compiles to the same statements, in the same order', () => {
    expect(shapeOf(compile(AS_APPROVAL))).toEqual(shapeOf(compile(BY_HAND)));
  });

  it('is compared against a shape with something in it', () => {
    // A comparison of two empty lists would pass
    // for the wrong reason, and this is the only
    // assertion in the file that proves the word
    // "desugared" rather than "plausible".
    const shape = shapeOf(compile(AS_APPROVAL));

    expect(shape).toContain('call DBOS.runStep sendNodeEmail');
    expect(shape).toContain('call DBOS.runStep registerWaitCorrelation');
    expect(shape).toContain('const DBOS.recv');
    expect(shape).toContain('call DBOS.runStep clearWaitCorrelation');
    // Three: the run id it checks it has, the
    // answer it checks arrived, and the decision
    // itself.
    expect(shape.filter((line) => line === 'if')).toHaveLength(3);
    expect(shape).toContain('else');
  });
});

/**
 * A wait longer than the link that opens it.
 *
 * A form or approval link is minted for one wait
 * and the runtime caps how long one lasts, however
 * long the wait it opens is. A longer wait would
 * emit two numbers that disagree: the person's only
 * way in dies, the run sleeps on, and the message
 * it finally aborts with names a number that was
 * never true.
 */
describe('a wait that would outlive the link that opens it', () => {
  function waitingDays(
    name: string,
    nodeId: string,
    timeoutDays: number,
  ): WorkflowIR {
    const ir = fixture(name);

    return WorkflowIRSchema.parse({
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, config: { ...node.config, timeoutDays } }
          : node,
      ),
    });
  }

  it('refuses a form wait set past the cap', () => {
    const result = refuse(waitingDays('form_intake', 'await_details', 45));

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;
    expect(result.nodeId).toBe('await_details');
    expect(result.message).toContain('45');
    expect(result.message).toContain('30');
  });

  it('refuses an approval set past it the same way', () => {
    const result = refuse(waitingDays('approval_flow', 'manager_ok', 60));

    expect(result.reason).toBe('UNSUPPORTED');
    if (result.reason !== 'UNSUPPORTED') return;
    expect(result.nodeId).toBe('manager_ok');
    expect(result.message).toContain('60');
  });

  it('takes one set exactly at the cap, and both numbers agree', () => {
    const written_ = compile(waitingDays('form_intake', 'await_details', 30));

    expect(written_).toContain('expiresInSeconds: 2592000,');
    expect(written_).toContain('timeoutSeconds: 2592000,');
  });

  it('leaves an event wait alone, because nobody was sent a link', () => {
    // Its way back in is the provider's webhook,
    // which does not expire.
    const written_ = compile(waitingDays('groom_booking', 'await_reply', 400));

    expect(written_).toContain('timeoutSeconds: 34560000,');
  });
});

describe('the order the statements of a wait come in', () => {
  it('registers, parks, clears, then asks — read off the parse tree', () => {
    // Read off the statements rather than searched
    // for in the text: the four names all appear
    // in the tables at the bottom of the file too,
    // and an order taken from a text search would
    // agree with itself while the run parked before
    // it had written the row that wakes it.
    const shape = shapeOf(compile(fixture('form_intake')));

    expect(atLine(shape, 'registerWaitCorrelation')).toBeLessThan(
      atLine(shape, 'DBOS.recv'),
    );
    expect(atLine(shape, 'DBOS.recv')).toBeLessThan(
      atLine(shape, 'clearWaitCorrelation'),
    );
    expect(atLine(shape, 'clearWaitCorrelation')).toBeLessThan(
      shape.lastIndexOf('if'),
    );
  });
});

describe('every attachment the compiler can emit', () => {
  /** The `kind` of each attachment in a compiled
   *  file, read out of the parsed source. */
  function attachKinds(text: string): string[] {
    const file = ts.createSourceFile(
      'w.ts',
      text,
      ts.ScriptTarget.ES2022,
      true,
    );
    const kinds: string[] = [];

    const walk = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(file) === 'attach' &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const property of node.initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          if (property.name.getText(file) !== 'kind') continue;
          kinds.push(property.initializer.getText(file).replaceAll("'", ''));
        }
      }

      ts.forEachChild(node, walk);
    };

    walk(file);
    return kinds;
  }

  const emitted = new Set(
    ['groom_booking', 'form_intake', 'form_retry', 'approval_flow'].flatMap(
      (name) => attachKinds(compile(fixture(name))),
    ),
  );

  it('is one the runtime declares and has a rendered email for', () => {
    // The compiler names what the runtime opens.
    // A fifth kind, or a fourth spelled wrong,
    // type-checks nowhere and renders as an email
    // with no link in it — which is a thing
    // somebody finds in their inbox rather than in
    // a test.
    const contract = readFileSync(
      join(scaffoldRoot, 'app', 'contract.ts'),
      'utf8',
    );
    const snapshots = readdirSync(
      join(scaffoldRoot, 'app', 'email', '__snapshots__'),
    );

    expect(emitted).toEqual(new Set(['none', 'form', 'approval', 'artifact']));

    for (const kind of emitted) {
      expect(contract).toContain(`kind: '${kind}'`);
    }

    // `none` renders the plain message; the other
    // three each carry a link and have a snapshot
    // of their own.
    expect(snapshots).toContain('node-email-plain.html');
    expect(snapshots).toContain('node-email-form.html');
    expect(snapshots).toContain('node-email-approval.html');
    expect(snapshots).toContain('node-email-artifact.html');
  });
});
