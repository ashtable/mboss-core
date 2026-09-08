import { describe, expect, it } from 'vitest';

import { NodeIdSchema } from '../ir/index.js';
import {
  LocalNames,
  SDK_OPERATIONS,
  camelCase,
  nameLiteralShape,
  nameShape,
  ownerOf,
  queuedWorkflowName,
  stepNameLiteral,
  type RecordedSegment,
  type StepSegment,
} from './names.js';

describe('camelCase', () => {
  it('turns a snake_case IR name into an identifier', () => {
    expect(camelCase('groom_booking')).toBe('groomBooking');
    expect(camelCase('parse_request')).toBe('parseRequest');
  });

  it('leaves a single word alone', () => {
    expect(camelCase('transaction')).toBe('transaction');
  });

  it('does not change the name a workflow registers under', () => {
    // The registered name is a wire contract with
    // the ingress route and with anything that
    // later enqueues by name, and the snake_case
    // IR name is its only stable spelling.
    const irName = 'groom_booking';

    expect(camelCase(irName)).not.toBe(irName);
    expect(irName).toBe('groom_booking');
  });
});

describe('LocalNames', () => {
  it('names a step local after its node, suffixed Out', () => {
    // Not after the declared out type: two nodes
    // in the canonical workflow both produce a
    // Booking, so a type-derived name needs
    // collision suffixes on the first real
    // workflow anyone writes.
    const locals = new LocalNames([]);

    expect(locals.forNode('find_slot')).toBe('findSlotOut');
    expect(locals.forNode('book_appointment')).toBe('bookAppointmentOut');
  });

  it('gives the same answer twice for the same node', () => {
    const locals = new LocalNames([]);

    expect(locals.forNode('find_slot')).toBe('findSlotOut');
    expect(locals.forNode('find_slot')).toBe('findSlotOut');
  });

  it('suffixes a second local that would collide', () => {
    const locals = new LocalNames([]);

    expect(locals.forNode('find_slot')).toBe('findSlotOut');
    expect(locals.forNode('findSlot')).toBe('findSlotOut2');
    expect(locals.forNode('find__slot')).toBe('findSlotOut3');
  });

  it('never hands back the name of an imported binding', () => {
    // The local would shadow the handler the step
    // is about to call.
    const locals = new LocalNames(['findSlotOut', 'evt']);

    expect(locals.forNode('find_slot')).toBe('findSlotOut2');
    expect(locals.take('evt')).toBe('evt2');
  });

  it('says whether a name is already spoken for', () => {
    // The emitter asks before it imports a
    // handler: a file cannot both import and
    // declare one identifier, so a handler whose
    // export name is already taken has to come in
    // under another one.
    const locals = new LocalNames(['parseRequest']);

    expect(locals.has('parseRequest')).toBe(true);
    expect(locals.has('findSlot')).toBe(false);
  });

  it('reserves a plain name for a temporary', () => {
    const locals = new LocalNames([]);

    expect(locals.take('items')).toBe('items');
    expect(locals.take('items')).toBe('items2');
  });
});

describe('stepNameLiteral', () => {
  it('is the bare node id in a linear region', () => {
    expect(stepNameLiteral('parse_request', [])).toBe("'parse_request'");
  });

  it('adds a round segment inside one loop', () => {
    expect(
      stepNameLiteral('find_slot', [{ kind: 'round', name: 'round' }]),
    ).toBe('`find_slot.r${round}`');
  });

  it('adds one round segment per loop, outermost first', () => {
    expect(
      stepNameLiteral('find_slot', [
        { kind: 'round', name: 'round' },
        { kind: 'round', name: 'round2' },
      ]),
    ).toBe('`find_slot.r${round}.r${round2}`');
  });

  it('adds the item index under a forEach', () => {
    expect(stepNameLiteral('charge_each', [{ kind: 'item' }])).toBe(
      '`charge_each[${offset + index}]`',
    );
  });

  it('keeps the regions outermost first when both apply', () => {
    // DBOS compares the recorded step name at each
    // function id on replay, so the order has to
    // be a property of the code rather than of the
    // order two emitters happened to run in.
    expect(
      stepNameLiteral('charge_each', [
        { kind: 'round', name: 'round' },
        { kind: 'item' },
      ]),
    ).toBe('`charge_each.r${round}[${offset + index}]`');
  });

  it('names the three steps a wait is made of', () => {
    expect(stepNameLiteral('await_reply', [{ kind: 'register' }])).toBe(
      "'await_reply.register'",
    );
    expect(stepNameLiteral('await_reply', [{ kind: 'clear' }])).toBe(
      "'await_reply.clear'",
    );
    expect(stepNameLiteral('manager_ok', [{ kind: 'ask' }])).toBe(
      "'manager_ok.ask'",
    );
  });

  it('counts a resend, so two reminders are two names', () => {
    expect(
      stepNameLiteral('await_form', [
        { kind: 'resend', counter: 'awaitFormResends' },
      ]),
    ).toBe('`await_form.resend.${awaitFormResends}`');
  });

  it('carries the round and the resend count together', () => {
    // Without the round, the first reminder of
    // round one and the first of round two both
    // record `await_form.resend.1`, and every
    // recovery after the second round fails.
    expect(
      stepNameLiteral('await_form', [
        { kind: 'round', name: 'round' },
        { kind: 'resend', counter: 'awaitFormResends' },
      ]),
    ).toBe('`await_form.r${round}.resend.${awaitFormResends}`');
  });
});

describe('queuedWorkflowName', () => {
  it('puts the block first and the workflow last', () => {
    // The block first because the reading side
    // cuts the name at the first dot and has to
    // land on the block. The workflow last because
    // two workflows may each hold a queue block
    // called `index_pages`, and each of them
    // registers a child of its own.
    expect(queuedWorkflowName('index_pages', 'document_ingestion_queued')).toBe(
      'index_pages.queued.document_ingestion_queued',
    );
  });
});

/**
 * One `StepSegment` per region a step name is
 * built from, written out rather than derived, so
 * a new kind fails to compile here until somebody
 * says what it looks like.
 *
 * That is what makes the round trip below binding:
 * a region the emitter starts rendering but the
 * literal parse cannot read would otherwise land
 * rows on the wrong block with nothing going red.
 *
 * The queued region is the one recorded region
 * with no `StepSegment` beside it: a queued child
 * is a workflow the emitter registers rather than
 * a step it names, so `queuedWorkflowName` renders
 * it and the test below that one holds the parse
 * to it.
 */
const EVERY_REGION: Record<
  Exclude<RecordedSegment['kind'], 'queued'>,
  StepSegment
> = {
  round: { kind: 'round', name: 'round' },
  item: { kind: 'item' },
  register: { kind: 'register' },
  clear: { kind: 'clear' },
  ask: { kind: 'ask' },
  resend: { kind: 'resend', counter: 'sent' },
};

describe('nameLiteralShape', () => {
  it('reads back every region the emitter renders', () => {
    for (const segment of Object.values(EVERY_REGION)) {
      const literal = stepNameLiteral('find_slot', [segment]);

      expect(nameLiteralShape(literal)).toBe(nameShape('find_slot', [segment]));
    }
  });

  it('reads back the name a queue block starts a child under', () => {
    // The one region `stepNameLiteral` does not
    // render. It still has to be read back: the
    // conformance check compares what a file
    // writes against what a document says it
    // records, and a registration this parse
    // cannot read is a row nobody accounts for.
    const name = queuedWorkflowName('index_pages', 'document_ingestion_queued');

    expect(nameLiteralShape(`'${name}'`)).toBe(
      nameShape('index_pages', [{ kind: 'queued' }]),
    );
    expect(nameLiteralShape(`'${name}'`)).toBe('index_pages.queued.#');
  });

  it('reduces the parts that vary to the region they name', () => {
    // A round is a round whether the name spells
    // it with a hole or with a number, and both
    // have to read as the same thing as what a
    // document says it can record.
    expect(nameLiteralShape('`find_slot.r${round}`')).toBe('find_slot.r#');
    expect(nameLiteralShape("'find_slot.r2'")).toBe('find_slot.r#');
    expect(nameLiteralShape('`confirm_each[${offset + index}]`')).toBe(
      'confirm_each[#]',
    );
    expect(nameLiteralShape('`await_details.r${round}.resend.${sent}`')).toBe(
      'await_details.r#.resend.#',
    );
  });

  it('tells a register apart from a round', () => {
    // Both open `.r`, and reading one as the other
    // would make a wait's rows compare equal to a
    // loop's.
    expect(nameLiteralShape("'await_details.register'")).toBe(
      'await_details.register',
    );
    expect(nameLiteralShape("'await_details.clear'")).toBe(
      'await_details.clear',
    );
    expect(nameLiteralShape("'manager_ok.ask'")).toBe('manager_ok.ask');
  });

  it('leaves a row the SDK named as it is', () => {
    expect(nameLiteralShape('DBOS.recv')).toBe('DBOS.recv');
    expect(nameLiteralShape('DBOS.sleep')).toBe('DBOS.sleep');
  });

  it('hands back what it cannot read, unchanged', () => {
    // Which fails the comparison it exists for
    // rather than passing quietly as something it
    // is not.
    expect(nameLiteralShape("'find_slot.middle'")).toBe("'find_slot.middle'");
  });
});

/**
 * The name a step really records: the literal the
 * emitter renders, unquoted, with every hole
 * filled by the value its expression holds at run
 * time.
 *
 * Going through `stepNameLiteral` rather than
 * writing the name out is the whole point of the
 * round trips below — a segment the emitter
 * changes has to fail here, not in whatever reads
 * a ledger months later.
 */
function recorded(
  literal: string,
  values: Readonly<Record<string, number>>,
): string {
  return literal
    .slice(1, -1)
    .replace(/\$\{(.+?)\}/g, (_, expression: string) => {
      const value = values[expression];
      if (value === undefined)
        throw new Error(`no value given for \${${expression}}`);

      return String(value);
    });
}

describe('ownerOf', () => {
  it('reads a step that runs once back as its own node', () => {
    const name = recorded(stepNameLiteral('parse_request', []), {});

    expect(name).toBe('parse_request');
    expect(ownerOf(name)).toEqual({
      kind: 'node',
      nodeId: 'parse_request',
      segments: [],
    });
  });

  it('reads a round back as the number the loop was on', () => {
    const name = recorded(
      stepNameLiteral('find_slot', [{ kind: 'round', name: 'round' }]),
      { round: 3 },
    );

    expect(name).toBe('find_slot.r3');
    expect(ownerOf(name)).toEqual({
      kind: 'node',
      nodeId: 'find_slot',
      segments: [{ kind: 'round', round: 3 }],
    });
  });

  it('reads one round per loop, outermost first', () => {
    const name = recorded(
      stepNameLiteral('find_slot', [
        { kind: 'round', name: 'round' },
        { kind: 'round', name: 'round2' },
      ]),
      { round: 1, round2: 4 },
    );

    expect(name).toBe('find_slot.r1.r4');
    expect(ownerOf(name)).toEqual({
      kind: 'node',
      nodeId: 'find_slot',
      segments: [
        { kind: 'round', round: 1 },
        { kind: 'round', round: 4 },
      ],
    });
  });

  it('reads the item index back off a forEach row', () => {
    const name = recorded(stepNameLiteral('charge_each', [{ kind: 'item' }]), {
      'offset + index': 7,
    });

    expect(name).toBe('charge_each[7]');
    expect(ownerOf(name)).toEqual({
      kind: 'node',
      nodeId: 'charge_each',
      segments: [{ kind: 'item', index: 7 }],
    });
  });

  it('reads the round and the item together', () => {
    const name = recorded(
      stepNameLiteral('charge_each', [
        { kind: 'round', name: 'round' },
        { kind: 'item' },
      ]),
      { round: 2, 'offset + index': 7 },
    );

    expect(name).toBe('charge_each.r2[7]');
    expect(ownerOf(name)).toEqual({
      kind: 'node',
      nodeId: 'charge_each',
      segments: [
        { kind: 'round', round: 2 },
        { kind: 'item', index: 7 },
      ],
    });
  });

  it('reads the three steps a wait is made of', () => {
    for (const [kind, name] of [
      ['register', 'await_reply.register'],
      ['clear', 'await_reply.clear'],
      ['ask', 'await_reply.ask'],
    ] as const) {
      expect(recorded(stepNameLiteral('await_reply', [{ kind }]), {})).toBe(
        name,
      );
      expect(ownerOf(name)).toEqual({
        kind: 'node',
        nodeId: 'await_reply',
        segments: [{ kind }],
      });
    }
  });

  it('reads a resend back as the reminder it counted', () => {
    const name = recorded(
      stepNameLiteral('await_form', [
        { kind: 'resend', counter: 'awaitFormResends' },
      ]),
      { awaitFormResends: 2 },
    );

    expect(name).toBe('await_form.resend.2');
    expect(ownerOf(name)).toEqual({
      kind: 'node',
      nodeId: 'await_form',
      segments: [{ kind: 'resend', count: 2 }],
    });
  });

  it('reads the two shapes a retried wait really records', () => {
    // A wait inside a loop is what the generated
    // form_retry workflow emits, and `.r1.register`
    // is where a parser that split on the last dot
    // rather than the first would go wrong.
    const registered = recorded(
      stepNameLiteral('await_details', [
        { kind: 'round', name: 'round' },
        { kind: 'register' },
      ]),
      { round: 1 },
    );
    const resent = recorded(
      stepNameLiteral('await_details', [
        { kind: 'round', name: 'round' },
        { kind: 'resend', counter: 'awaitDetailsResends' },
      ]),
      { round: 1, awaitDetailsResends: 2 },
    );

    expect(registered).toBe('await_details.r1.register');
    expect(ownerOf(registered)).toEqual({
      kind: 'node',
      nodeId: 'await_details',
      segments: [{ kind: 'round', round: 1 }, { kind: 'register' }],
    });

    expect(resent).toBe('await_details.r1.resend.2');
    expect(ownerOf(resent)).toEqual({
      kind: 'node',
      nodeId: 'await_details',
      segments: [
        { kind: 'round', round: 1 },
        { kind: 'resend', count: 2 },
      ],
    });
  });

  it('reads a queued child back as the block that started it', () => {
    // A queue block records one row per item it
    // enqueues, and the row carries the child's
    // registered name rather than a name the block
    // wrote — so this is the only way the ledger
    // says which block the fan-out belongs to.
    const name = queuedWorkflowName('index_pages', 'document_ingestion_queued');

    expect(name).toBe('index_pages.queued.document_ingestion_queued');
    expect(ownerOf(name)).toEqual({
      kind: 'node',
      nodeId: 'index_pages',
      segments: [{ kind: 'queued', workflow: 'document_ingestion_queued' }],
    });
  });

  it('leaves the rows a queue block waits on to the SDK', () => {
    // The other half of what a fan-out records:
    // every item is awaited through its handle,
    // and the SDK names each of those rows itself.
    expect(ownerOf('DBOS.getResult')).toEqual({
      kind: 'sdk',
      name: 'DBOS.getResult',
    });
  });

  it('gives the SDK its own rows, prefixed or not', () => {
    expect(ownerOf('DBOS.recv')).toEqual({ kind: 'sdk', name: 'DBOS.recv' });

    // The un-prefixed one is the reason the set
    // exists: read syntactically it is a plausible
    // node id, and a block called `get_status`
    // would otherwise be handed the SDK's row.
    expect(ownerOf('getStatus')).toEqual({ kind: 'sdk', name: 'getStatus' });
  });

  it('gives the SDK a primitive this list has never heard of', () => {
    // The set alone would misattribute whatever a
    // later SDK adds; no node id can start `DBOS.`,
    // so the prefix is the safer of the two tests.
    expect(SDK_OPERATIONS.has('DBOS.somethingNew')).toBe(false);
    expect(ownerOf('DBOS.somethingNew')).toEqual({
      kind: 'sdk',
      name: 'DBOS.somethingNew',
    });
  });

  it('keeps a name it cannot parse rather than throwing', () => {
    // A ledger holds rows from every workflow in
    // the app, hand-written ones included, and one
    // unreadable row must not cost the reader the
    // rest of the run.
    for (const name of [
      '',
      'Ω',
      'a b c',
      'chargeCard',
      'find_slot.',
      'find_slot.r',
      'charge_each[]',
      '.register',
    ]) {
      expect(ownerOf(name)).toEqual({ kind: 'unknown', name });
    }
  });
});

describe('SDK_OPERATIONS', () => {
  it('is every name the SDK reserves for a primitive', () => {
    // Ten prefixed and one bare, matching the
    // function names the SDK writes into the
    // ledger itself.
    expect([...SDK_OPERATIONS].sort()).toEqual([
      'DBOS.closeStream',
      'DBOS.getEvent',
      'DBOS.getResult',
      'DBOS.readStream',
      'DBOS.readStreamOffset',
      'DBOS.recv',
      'DBOS.send',
      'DBOS.setEvent',
      'DBOS.sleep',
      'DBOS.writeStream',
      'getStatus',
    ]);
  });
});

describe('the coupling that lets ownerOf split a name', () => {
  it('never lets a node id hold a dot or a bracket', () => {
    // `ownerOf` takes the id to be everything
    // before the first `.` or `[`. That is sound
    // only because an id may contain neither, and
    // nothing held the two halves together until
    // this test.
    expect(NodeIdSchema.safeParse('a.b').success).toBe(false);
    expect(NodeIdSchema.safeParse('a[0]').success).toBe(false);
    expect(NodeIdSchema.safeParse('find_slot').success).toBe(true);
  });

  it('never lets a block id spell a queued region of its own', () => {
    // A block whose id held `.queued.` would read
    // as some other block's fan-out, and every row
    // it recorded would be filed under a block
    // that is not it.
    expect(
      NodeIdSchema.safeParse('index_pages.queued.other_flow').success,
    ).toBe(false);
  });
});
