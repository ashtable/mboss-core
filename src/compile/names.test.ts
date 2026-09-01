import { describe, expect, it } from 'vitest';

import { LocalNames, camelCase, stepNameLiteral } from './names.js';

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
