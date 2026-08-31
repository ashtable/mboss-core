import { describe, expect, it } from 'vitest';

import {
  determinismProblems,
  headerProblems,
  registrationProblems,
  stepProblems,
} from './audit.js';

function why(problems: { why: string }[]): string[] {
  return problems.map((problem) => problem.why);
}

describe('determinismProblems', () => {
  it('reports a clock read in a workflow body', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  const now = Date.now();',
      '  return;',
      '}',
    ].join('\n');

    expect(why(determinismProblems(source))).toEqual([
      'Date.now() reads the clock, and a replay would read a different one',
    ]);
  });

  it('stays quiet about the same call inside a step', () => {
    // A step runs once and its result is
    // checkpointed. That is the whole point of
    // putting a clock read in one.
    const source = [
      'async function fn(): Promise<void> {',
      "  await DBOS.runStep(async () => Date.now(), { name: 'a' });",
      '}',
    ].join('\n');

    expect(determinismProblems(source)).toEqual([]);
  });

  it('reports the other ways a body stops being reproducible', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  const a = Math.random();',
      '  const b = await fetch(url);',
      '  const c = new Date();',
      '  setTimeout(go, 1);',
      '}',
    ].join('\n');

    expect(why(determinismProblems(source))).toHaveLength(4);
  });

  it('leaves a date built from a literal alone', () => {
    // A schedule's bounds are constants. They are
    // the same on every replay, which is the only
    // thing this rule is about.
    const source = "const STARTS = new Date('2026-01-01T00:00:00.000Z');\n";

    expect(determinismProblems(source)).toEqual([]);
  });

  it('allows the SDK clock and id anywhere', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  const a = DBOS.now();',
      '  const b = DBOS.randomUUID();',
      '}',
    ].join('\n');

    expect(determinismProblems(source)).toEqual([]);
  });

  it('reports Promise.all wherever it appears', () => {
    // One rejection takes the process down before
    // the others have checkpointed.
    const source = 'const all = await Promise.all(work);\n';

    expect(why(determinismProblems(source))).toEqual([
      'Promise.all drops the results of everything that had not settled',
    ]);
  });

  it('reports the datasource client outside a transaction', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  const row = await appDb.client.run.create({ data: {} });',
      '}',
    ].join('\n');

    expect(why(determinismProblems(source))).toEqual([
      'the datasource client only exists inside a transaction',
    ]);
  });

  it('allows the client inside a transaction callback', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  await appDb.runTransaction(async () => appDb.client.run.create({}), {',
      "    name: 'a',",
      '  });',
      '}',
    ].join('\n');

    expect(determinismProblems(source)).toEqual([]);
  });

  it('reports the line the problem is on', () => {
    const source = ['const a = 1;', 'const b = Date.now();'].join('\n');

    expect(determinismProblems(source)[0]?.line).toBe(2);
  });
});

describe('stepProblems', () => {
  const good = [
    'async function fn(): Promise<void> {',
    '  await DBOS.runStep(async () => work(), {',
    "    name: 'work',",
    '    retriesAllowed: true,',
    '  });',
    '}',
  ].join('\n');

  it('passes a step that says all three things', () => {
    expect(stepProblems(good)).toEqual([]);
  });

  it('reports a step with no name', () => {
    const source = good.replace("    name: 'work',\n", '');

    expect(why(stepProblems(source))).toContain(
      'a step with no name: DBOS records the name and compares it on replay',
    );
  });

  it('reports a step that leaves retriesAllowed to the default', () => {
    // The SDK's default is false, so a template
    // that omits it silently disables every retry.
    const source = good.replace('    retriesAllowed: true,\n', '');

    expect(why(stepProblems(source))).toContain(
      "the step 'work' does not say whether retries are allowed",
    );
  });

  it('reports a callback that is not an async arrow', () => {
    // runStep takes `() => Promise<T>`, and the
    // manifest cannot tell a synchronous handler
    // from an asynchronous one.
    const source = good.replace('async () => work()', '() => work()');

    expect(why(stepProblems(source))).toContain(
      "the step 'work' is not run through an async arrow",
    );
  });

  it('asks the same of a transaction, apart from the retries', () => {
    // A transaction's config carries an isolation
    // level, a read-only flag and a name. It has
    // no retry field, so there is nothing for one
    // to say about retries — but a name it does
    // record, and DBOS compares that on replay
    // exactly as it does a step's.
    const source = [
      'async function fn(): Promise<void> {',
      '  await appDb.runTransaction(async () => work(), {',
      "    name: 'work',",
      '  });',
      '}',
    ].join('\n');

    expect(stepProblems(source)).toEqual([]);
    expect(
      why(stepProblems(source.replace("    name: 'work',\n", ''))),
    ).toEqual([
      'a step with no name: DBOS records the name and compares it on replay',
    ]);
    expect(
      why(stepProblems(source.replace('async () => work()', '() => work()'))),
    ).toEqual(["the step 'work' is not run through an async arrow"]);
  });

  it('counts a transaction into the same set of recorded names', () => {
    // The names have to be unique across the file,
    // not within one kind of call: a fanned-out
    // transaction records a templated name just as
    // a fanned-out step does.
    const source = [
      'async function fn(): Promise<void> {',
      '  await DBOS.runStep(async () => a(), {',
      "    name: 'x',",
      '    retriesAllowed: true,',
      '  });',
      "  await appDb.runTransaction(async () => b(), { name: 'x' });",
      '}',
    ].join('\n');

    expect(why(stepProblems(source))).toContain(
      "two steps both record the name 'x'",
    );
  });

  it('reports two steps that would record the same name', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  await DBOS.runStep(async () => a(), {',
      "    name: 'x',",
      '    retriesAllowed: true,',
      '  });',
      '  await DBOS.runStep(async () => b(), {',
      "    name: 'x',",
      '    retriesAllowed: true,',
      '  });',
      '}',
    ].join('\n');

    expect(why(stepProblems(source))).toContain(
      "two steps both record the name 'x'",
    );
  });

  it('reads through a template literal to compare names', () => {
    // Two steps inside the same region differ only
    // by a counter, and that is not a collision.
    const source = [
      'async function fn(): Promise<void> {',
      '  await DBOS.runStep(async () => a(), {',
      '    name: `x[${offset + index}]`,',
      '    retriesAllowed: true,',
      '  });',
      '  await DBOS.runStep(async () => b(), {',
      '    name: `y[${offset + index}]`,',
      '    retriesAllowed: true,',
      '  });',
      '}',
    ].join('\n');

    expect(stepProblems(source)).toEqual([]);
  });

  it('still catches a collision between two template names', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  await DBOS.runStep(async () => a(), {',
      '    name: `x[${offset + index}]`,',
      '    retriesAllowed: true,',
      '  });',
      '  await DBOS.runStep(async () => b(), {',
      '    name: `x[${offset + other}]`,',
      '    retriesAllowed: true,',
      '  });',
      '}',
    ].join('\n');

    expect(why(stepProblems(source))).toContain(
      'two steps both record the name `x[*]`',
    );
  });
});

describe('headerProblems', () => {
  const header = [
    '// GENERATED BY MBOSS — DO NOT EDIT.',
    '// Regenerated from',
    '// .mboss/workflows/groom_booking.workflow.json.',
    '',
    'export const a = 1;',
    '',
  ].join('\n');

  it('passes the three lines the header is', () => {
    expect(headerProblems(header, 'groom_booking')).toEqual([]);
  });

  it('reports a header naming another workflow', () => {
    expect(why(headerProblems(header, 'other'))).toHaveLength(1);
  });

  it('reports a header that is missing', () => {
    expect(why(headerProblems('export const a = 1;\n', 'x'))).toHaveLength(1);
  });

  it('reports a header with a hyphen where the em-dash is', () => {
    const wrong = header.replace('—', '-');

    expect(why(headerProblems(wrong, 'groom_booking'))).toHaveLength(1);
  });
});

describe('registrationProblems', () => {
  const registered = [
    'async function groomBookingFn(): Promise<void> {}',
    '',
    'export const groomBooking = DBOS.registerWorkflow(groomBookingFn, {',
    "  name: 'groom_booking',",
    '});',
    '',
  ].join('\n');

  it('passes a free function registered at module scope', () => {
    expect(registrationProblems(registered, 'groom_booking')).toEqual([]);
  });

  it('reports a registration under a name of its own devising', () => {
    const wrong = registered.replace("'groom_booking'", "'groomBooking'");

    expect(why(registrationProblems(wrong, 'groom_booking'))).toContain(
      "the workflow registers as 'groomBooking', not 'groom_booking'",
    );
  });

  it('reports a registration with no name at all', () => {
    const wrong = registered.replace(", {\n  name: 'groom_booking',\n}", '');

    expect(why(registrationProblems(wrong, 'groom_booking'))).toContain(
      'the registration does not say what name to register under',
    );
  });

  it('reports a file with no registration', () => {
    expect(
      why(registrationProblems('export const a = 1;\n', 'groom_booking')),
    ).toContain('the file registers no workflow');
  });

  it('reports two registrations in one file', () => {
    expect(
      why(registrationProblems(`${registered}${registered}`, 'groom_booking')),
    ).toContain('the file registers more than one workflow');
  });

  it('reports a registration that is not exported', () => {
    const wrong = registered.replace('export const groomBooking', 'const b');

    expect(why(registrationProblems(wrong, 'groom_booking'))).toContain(
      'the registered workflow is not exported',
    );
  });

  it('reports the undecorated function being exported as well', () => {
    // Two exported spellings of one workflow is
    // how half an app ends up calling the one that
    // was never registered.
    const wrong = registered.replace(
      'async function groomBookingFn',
      'export async function groomBookingFn',
    );

    expect(why(registrationProblems(wrong, 'groom_booking'))).toContain(
      'groomBookingFn is exported as well as the registered workflow',
    );
  });

  it('reports a registration hidden inside a function', () => {
    const wrong = [
      'export function install() {',
      '  return DBOS.registerWorkflow(fn, {',
      "    name: 'groom_booking',",
      '  });',
      '}',
      '',
    ].join('\n');

    expect(why(registrationProblems(wrong, 'groom_booking'))).toContain(
      'the registration does not run when the module is imported',
    );
  });

  it('reports one bound to a local inside a function', () => {
    // The shape that reads most like the right
    // one: a `const` holding the registered
    // workflow, in a function nobody calls before
    // launch.
    const wrong = [
      'export function install() {',
      '  const groomBooking = DBOS.registerWorkflow(fn, {',
      "    name: 'groom_booking',",
      '  });',
      '  return groomBooking;',
      '}',
      '',
    ].join('\n');

    expect(why(registrationProblems(wrong, 'groom_booking'))).toContain(
      'the registration does not run when the module is imported',
    );
  });
});

describe('what belongs to the workflow and not to a step', () => {
  it('reports a wait parked from inside a step', () => {
    // An invalid transition, and the SDK only says
    // so at run time — on the day somebody's run
    // reaches that step.
    const source = [
      'async function fn(): Promise<void> {',
      '  await DBOS.runStep(async () => DBOS.recv("reply"), {',
      "    name: 'a',",
      '    retriesAllowed: false,',
      '  });',
      '}',
    ].join('\n');

    expect(determinismProblems(source).map((p) => p.why)).toEqual([
      'DBOS.recv() parks the workflow and cannot run inside a step',
    ]);
  });

  it('leaves the same call alone in a workflow body', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  const reply = await DBOS.recv("reply");',
      '  await DBOS.setEvent("done", 1);',
      '}',
    ].join('\n');

    expect(determinismProblems(source)).toEqual([]);
  });
});
