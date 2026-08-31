import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { scanLib } from '../manifest/index.js';
import { fixturesRoot, readFixtureJson } from '../test-support/fixtures.js';
import { makeIR, type NodeSpec } from '../test-support/ir.js';

import { stepProblems } from './audit.js';
import { compileWorkflow, type CompileResult } from './compile.js';
import {
  writeBackEdgeLoop,
  writeBranch,
  writeCountedLoop,
  type CarriedValue,
} from './emit-control.js';
import { SourceWriter } from './source.js';

/**
 * How control flow reaches the page, tested apart
 * from what decides it.
 *
 * Every body below is a closure writing one marker
 * line, so these say only what the shape of an
 * emitted branch or loop is. Which arm goes where
 * is the emitter's business, and that is tested
 * against compiled fixtures instead.
 */

const UNREACHABLE =
  'Unreachable: every route out of the loop that sets resume has ' +
  'already assigned this.';

function write(fill: (writer: SourceWriter) => void): string[] {
  const writer = new SourceWriter();

  fill(writer);

  return writer.toString().split('\n').slice(0, -1);
}

/** An arm that writes one line and falls through. */
function stays(writer: SourceWriter, text: string): () => boolean {
  return () => {
    writer.line(text);
    return false;
  };
}

/** An arm that writes one line and leaves. */
function leaves(writer: SourceWriter, text: string): () => boolean {
  return () => {
    writer.line(text);
    return true;
  };
}

describe('writeBranch', () => {
  it('writes the cases in the order the author put them in', () => {
    const lines = write((writer) => {
      writeBranch(writer, [
        { condition: 'a', body: stays(writer, 'one();') },
        { condition: 'b', body: stays(writer, 'two();') },
        { condition: 'c', body: stays(writer, 'three();') },
        { body: stays(writer, 'rest();') },
      ]);
    });

    expect(lines).toEqual([
      'if (a) {',
      '  one();',
      '} else if (b) {',
      '  two();',
      '} else if (c) {',
      '  three();',
      '} else {',
      '  rest();',
      '}',
    ]);
  });

  it('lets a case that leaves stand on its own', () => {
    // Nothing after an arm that breaks, continues
    // or returns can run when that arm was taken,
    // so the next case needs no `else` and reads
    // better without one.
    const lines = write((writer) => {
      writeBranch(writer, [
        { condition: 'a', body: leaves(writer, 'break;') },
        { body: stays(writer, 'rest();') },
      ]);
    });

    expect(lines).toEqual(['if (a) {', '  break;', '}', '', 'rest();']);
  });

  it('keeps the chain once a case falls through', () => {
    // The first arm falls through, so a later arm
    // stays inside the same chain even though it
    // leaves: a fresh `if` would run after the
    // first arm had already run.
    const lines = write((writer) => {
      writeBranch(writer, [
        { condition: 'a', body: stays(writer, 'one();') },
        { condition: 'b', body: leaves(writer, 'return;') },
        { body: stays(writer, 'rest();') },
      ]);
    });

    expect(lines).toEqual([
      'if (a) {',
      '  one();',
      '} else if (b) {',
      '  return;',
      '} else {',
      '  rest();',
      '}',
    ]);
  });
});

describe('writeBackEdgeLoop', () => {
  const CARRIED: CarriedValue[] = [
    { name: 'findSlotCarried', type: 'SlotGrid', nodeId: 'find_slot' },
  ];

  it('bounds the loop and throws when the rounds run out', () => {
    const lines = write((writer) => {
      writeBackEdgeLoop(writer, {
        round: 'round',
        resume: 'resume',
        carried: [],
        workflow: 'groom_booking',
        unreachable: UNREACHABLE,
        exhaustion: {
          kind: 'abort',
          rounds: 10,
          problem:
            'reply_decision: new_time repeated 10 times without a result.',
        },
        body: () => {
          writer.line('work();');
        },
      });
    });

    expect(lines).toEqual([
      'let round = 0;',
      'let resume = false;',
      '',
      'do {',
      '  round += 1;',
      '',
      '  work();',
      '} while (round < 10);',
      '',
      'if (!resume) {',
      '  throw new Error(',
      "    'reply_decision: new_time repeated 10 times without a result.',",
      '  );',
      '}',
    ]);
  });

  it('never throws when an exhausted case is told to fall through', () => {
    const lines = write((writer) => {
      writeBackEdgeLoop(writer, {
        round: 'round',
        resume: 'resume',
        carried: [],
        workflow: 'groom_booking',
        unreachable: UNREACHABLE,
        exhaustion: { kind: 'continue' },
        body: () => {
          writer.line('work();');
        },
      });
    });

    expect(lines).toEqual([
      'let round = 0;',
      'let resume = false;',
      '',
      'do {',
      '  round += 1;',
      '',
      '  work();',
      '} while (!resume);',
      '',
      'if (!resume) return;',
    ]);
  });

  it('hoists a value the loop carries out and checks it once', () => {
    // The declaration cannot claim definite
    // assignment — TypeScript will not accept one
    // for a variable only assigned inside a `do`
    // body — so the type admits `undefined` and the
    // check says it never happens.
    const lines = write((writer) => {
      writeBackEdgeLoop(writer, {
        round: 'round',
        resume: 'resume',
        carried: CARRIED,
        workflow: 'groom_booking',
        unreachable: UNREACHABLE,
        exhaustion: { kind: 'continue' },
        body: () => {
          writer.line('work();');
        },
      });
    });

    expect(lines[2]).toBe('let findSlotCarried: SlotGrid | undefined;');
    expect(lines).toContain('if (findSlotCarried === undefined) {');
    expect(lines.at(-2)).toBe(
      "  throw new Error('groom_booking: find_slot produced no result.');",
    );
    expect(lines.at(-1)).toBe('}');
  });
});

describe('writeCountedLoop', () => {
  it('counts up to the bound the author asked for', () => {
    const lines = write((writer) => {
      writeCountedLoop(writer, {
        round: 'round',
        rounds: 4,
        carried: [],
        workflow: 'review_loop',
        unreachable: UNREACHABLE,
        body: () => {
          writer.line('work();');
        },
      });
    });

    expect(lines).toEqual([
      'for (let round = 1; round <= 4; round += 1) {',
      '  work();',
      '}',
    ]);
  });
});

const MANIFEST = scanLib(join(fixturesRoot, 'lib'));

const TIMEZONE = 'America/Los_Angeles';

function fixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

function compile(ir: WorkflowIR): string {
  const result = compileWorkflow({
    ir,
    manifest: MANIFEST,
    timezone: TIMEZONE,
  });

  if (!result.ok) {
    throw new Error(`compile failed: ${JSON.stringify(result, null, 2)}`);
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

describe('a branch with three ways out', () => {
  const source = compile(fixture('branch_three_ways'));

  it('tests the cases in the order the author put them in', () => {
    const free = source.indexOf('findSlotOut.requestedSlotFree === true');
    const offer = source.indexOf('(findSlotOut.alternatives?.length ?? 0) > 0');
    const later = source.indexOf('(findSlotOut.requestedAt?.length ?? 0) > 0');

    expect(free).toBeGreaterThan(-1);
    expect(offer).toBeGreaterThan(free);
    expect(later).toBeGreaterThan(offer);
  });

  it('chains them, so only the first match runs', () => {
    expect(source).toContain(
      '} else if ((findSlotOut.alternatives?.length ?? 0) > 0) {',
    );
  });

  it('ends the run on the way out that is wired to nothing', () => {
    expect(source).toContain('} else {\n    return;\n  }');
  });

  it('emits the block the arms meet again at exactly once', () => {
    expect(source.split("name: 'wrap_up'").length - 1).toBe(1);
  });
});

describe('a loop drawn as a wire back, told to abort', () => {
  const source = compile(fixture('chat_retry_abort'));

  it('repeats until the branch says otherwise', () => {
    expect(source).toContain('do {');
    expect(source).toContain('} while (round < 10);');
  });

  it('records each round under its own step name', () => {
    expect(source).toContain('name: `find_slot.r${round}`,');
    expect(source).toContain('name: `twilio_chat.r${round}`,');
    expect(source).toContain('name: `read_reply.r${round}`,');
  });

  it('leaves the loop for the one block that follows it', () => {
    expect(source).toContain('resume = true;\n      break;');
  });

  it('goes round again on the case that wires back', () => {
    expect(source).toContain(
      "if (readReplyOut.intent === 'reschedule') {\n      continue;\n    }",
    );
  });

  it('fails the run when the rounds are used up', () => {
    expect(source).toContain('if (!resume) {');
    expect(source).toContain(
      "'reply_decision: new_time repeated 10 times without a result.',",
    );
  });

  it('carries the value the blocks after the loop read', () => {
    expect(source).toContain('let findSlotCarried: SlotGrid | undefined;');
    expect(source).toContain('findSlotCarried = findSlotOut;');
    expect(source).toContain('if (findSlotCarried === undefined) {');
    expect(source).toContain(
      "throw new Error('chat_retry_abort: find_slot produced no result.');",
    );
    expect(source).toContain('bookAppointment(findSlotCarried)');
  });
});

describe('a loop drawn as a wire back, told to carry on', () => {
  const source = compile(fixture('chat_retry_continue'));

  it('folds the bound into the case that wires back', () => {
    expect(source).toContain(
      "if (round < 10 && readReplyOut.intent === 'reschedule') {",
    );
  });

  it('repeats until something leaves, and never throws', () => {
    expect(source).toContain('} while (!resume);');
    expect(source).toContain('if (!resume) return;');
    expect(source).not.toContain('repeated 10 times');
  });

  it('still checks the value it carried out', () => {
    // The check is about the type, not about the
    // bound, so it is here whichever way an
    // exhausted case was told to behave.
    expect(source).toContain('if (findSlotCarried === undefined) {');
  });
});

describe('the loop block', () => {
  const source = compile(fixture('review_loop'));

  it('counts up to the bound the author set', () => {
    expect(source).toContain('for (let round = 1; round <= 4; round += 1) {');
  });

  it('numbers every step inside it by its round', () => {
    expect(source).toContain('name: `find_slot.r${round}`,');
    expect(source).toContain('name: `twilio_chat.r${round}`,');
  });

  it('carries on at the one block the body is wired to', () => {
    expect(source).toContain("name: 'read_reply',");
    expect(source).toContain('readReply(twilioChatCarried)');
  });

  it('does not compile the floor, because nothing could end it early', () => {
    // `minRounds` is authored and inert: a workflow
    // document carries no signal that would end a
    // loop early, so "between two and four rounds
    // with nothing to stop it" can only be four.
    // The ceiling is the only bound in the file.
    const bounds = [...source.matchAll(/round [<>]=? \d+/g)].map(
      (found) => found[0],
    );

    expect(bounds).toEqual(['round <= 4']);
  });

  it('compiles the same whether or not models were chosen', () => {
    // The models a canvas pinned are stored so a
    // compiled app runs what its author saw. There
    // is no client to run them through yet, so the
    // field is carried and not compiled — pinned
    // here rather than left to be noticed.
    const withModels = fixture('review_loop');
    const withoutModels = WorkflowIRSchema.parse({
      ...readFixtureJson<{ nodes: { config?: { models?: unknown } }[] }>(
        'ir/review_loop.workflow.json',
      ),
      nodes: fixture('review_loop').nodes.map((node) =>
        node.kind === 'loop'
          ? { ...node, config: { ...node.config, models: undefined } }
          : node,
      ),
    });

    expect(compile(withoutModels)).toBe(compile(withModels));
  });
});

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

describe('a block inside a loop body', () => {
  const source = compile(
    makeIR({
      name: 'guarded_round',
      nodes: [
        TRIGGER,
        {
          id: 'draft_rounds',
          kind: 'loop',
          title: 'Draft and check',
          config: {
            minRounds: 1,
            maxRounds: 3,
            body: ['find_slot', 'sweep_old'],
          },
        },
        FIND_SLOT,
        {
          id: 'sweep_old',
          kind: 'step',
          title: 'Clear stale holds',
          handler: { export: 'sweepStale' },
          guard: { path: 'requestedSlotFree', op: 'eq', value: true },
          config: {},
        },
      ],
      edges: [
        { from: 'review_started', to: 'draft_rounds', type: 'BookingReq' },
        { from: 'draft_rounds', to: 'find_slot', type: 'BookingReq' },
        { from: 'find_slot', to: 'sweep_old', type: 'SlotGrid' },
      ],
    }),
  );

  it('opens its condition around a local the round bound', () => {
    expect(source).toContain('if (findSlotOut.requestedSlotFree === true) {');
    expect(source).toContain('const sweepOldOut = await DBOS.runStep');
  });

  it('records the round in the guarded block’s step name too', () => {
    expect(source).toContain('name: `sweep_old.r${round}`,');
  });

  it('carries nothing out, because nothing after it reads anything', () => {
    // A compiler that hoisted every loop-bound
    // value would put a dead `let` and a dead check
    // in every loop it compiled.
    expect(source).not.toContain('Carried');
    expect(source).not.toContain('=== undefined');
    expect(stepProblems(source)).toEqual([]);
  });
});

describe('a fan-out inside a loop', () => {
  const source = compile(
    makeIR({
      name: 'confirm_rounds',
      nodes: [
        TRIGGER,
        {
          id: 'draft_rounds',
          kind: 'loop',
          title: 'Draft and check',
          config: {
            minRounds: 1,
            maxRounds: 2,
            body: ['find_slot', 'confirm_each'],
          },
        },
        FIND_SLOT,
        {
          id: 'confirm_each',
          kind: 'step',
          title: 'Confirm each time',
          handler: { export: 'confirmSlot' },
          in: 'SlotGrid',
          out: 'Booking',
          forEach: { itemsPath: 'alternatives', concurrency: 4 },
          config: {},
        },
      ],
      edges: [
        { from: 'review_started', to: 'draft_rounds', type: 'BookingReq' },
        { from: 'draft_rounds', to: 'find_slot', type: 'BookingReq' },
        { from: 'find_slot', to: 'confirm_each', type: 'SlotGrid' },
      ],
    }),
  );

  it('names the round and the item, outermost first', () => {
    expect(source).toContain(
      'name: `confirm_each.r${round}[${offset + index}]`,',
    );
  });

  it('still records a name no other step in the file records', () => {
    expect(stepProblems(source)).toEqual([]);
  });
});

describe('what control flow this compiler will not follow', () => {
  it('refuses a loop with two ways out', () => {
    // The alternatives are duplicating the tail —
    // which records the same step name twice — or a
    // switch that scatters what comes after.
    const result = refuse(
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

    expect(result).toMatchObject({ reason: 'UNSUPPORTED', nodeId: 'route' });
    if ('message' in result) {
      expect(result.message).toContain('one way out');
    }
  });

  it('refuses a document where a block it can reach is never written', () => {
    // A loop whose body nothing wires into leaves
    // the walk with nowhere to carry on, and the
    // block after it would simply be missing from
    // the file. Nothing else would say so: it would
    // compile, run, and quietly skip the work.
    const result = refuse(
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

    expect(result).toMatchObject({ reason: 'UNSUPPORTED', nodeId: 'wrap_up' });
  });
});

describe('a case that says nothing about how often it may repeat', () => {
  it('takes the ten rounds the schema already defaults to', () => {
    const source = compile(
      makeIR({
        name: 'unbounded_case',
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
                },
                {
                  port: 'book',
                  when: { path: 'requestedSlotFree', op: 'eq', value: true },
                },
              ],
              elsePort: 'stop',
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
          { from: 'find_slot', to: 'route', type: 'SlotGrid' },
          {
            from: 'route',
            port: 'again',
            to: 'find_slot',
            type: 'BookingReq',
            back: true,
          },
          { from: 'route', port: 'book', to: 'book_now', type: 'SlotGrid' },
        ],
      }),
    );

    expect(source).toContain('} while (round < 10);');
  });
});

describe('a way out that goes straight to where the arms meet', () => {
  const source = compile(
    makeIR({
      name: 'skip_arm',
      nodes: [
        TRIGGER,
        FIND_SLOT,
        {
          id: 'route',
          kind: 'branch',
          title: 'Anything to offer?',
          in: 'SlotGrid',
          config: {
            cases: [
              {
                port: 'skip',
                when: { path: 'requestedSlotFree', op: 'eq', value: true },
              },
              {
                port: 'offer',
                when: { path: 'alternatives', op: 'nonempty' },
              },
            ],
            elsePort: 'none',
          },
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
        {
          id: 'wrap_up',
          kind: 'step',
          title: 'Tidy up',
          handler: { export: 'sweepStale' },
          config: {},
        },
      ],
      edges: [
        { from: 'review_started', to: 'find_slot', type: 'BookingReq' },
        { from: 'find_slot', to: 'route', type: 'SlotGrid' },
        { from: 'route', port: 'skip', to: 'wrap_up' },
        { from: 'route', port: 'offer', to: 'offer_times', type: 'SlotGrid' },
        { from: 'route', port: 'none', to: 'wrap_up' },
        { from: 'offer_times', to: 'wrap_up', type: 'ChatPrompt' },
      ],
    }),
  );

  it('says so rather than leaving an empty block', () => {
    expect(source).toContain(
      'if (findSlotOut.requestedSlotFree === true) {\n' +
        '    // Nothing of its own to do on this way out.\n' +
        '  } else if',
    );
  });

  it('still emits what the arms meet at exactly once', () => {
    expect(source.split("name: 'wrap_up'").length - 1).toBe(1);
  });
});
