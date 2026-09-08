import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixturesRoot, readFixture } from '../test-support/fixtures.js';

import {
  determinismProblems,
  headerProblems,
  placementProblems,
  queueProblems,
  recordedNameLiterals,
  registrationProblems,
  stepProblems,
} from './audit.js';

function why(problems: { why: string }[]): string[] {
  return problems.map((problem) => problem.why);
}

/** One blessed compiler output, as its source. */
function golden(name: string): string {
  return readFixture(`golden/compile/${name}.workflow.ts`);
}

/**
 * The blessed outputs in one directory, as the
 * workflow names they were compiled for. A golden
 * is named for its workflow, which is what the two
 * rules that take a name need.
 */
function goldenNames(dir: string): string[] {
  return readdirSync(join(fixturesRoot, 'golden', dir))
    .filter((file) => file.endsWith('.workflow.ts'))
    .map((file) => file.replace('.workflow.ts', ''))
    .sort();
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

describe('a queue block child registered beside its parent', () => {
  // Two registrations in one file, which the rule
  // used to refuse outright. The child is the one
  // a queue enqueues, so it registers under a name
  // of the block's own and stays unexported: only
  // the parent is anybody else's to start.
  const queued = [
    'async function indexPagesQueuedFn(item: Page): Promise<Indexed> {',
    '  return await index(item);',
    '}',
    '',
    'const indexPagesQueued = DBOS.registerWorkflow(indexPagesQueuedFn, {',
    "  name: 'index_pages.queued.document_ingestion',",
    '});',
    '',
    'async function documentIngestionFn(): Promise<void> {}',
    '',
    'export const documentIngestion = DBOS.registerWorkflow(',
    '  documentIngestionFn,',
    '  {',
    "    name: 'document_ingestion',",
    '  },',
    ');',
    '',
  ].join('\n');

  it('passes, though the file holds two registrations', () => {
    expect(registrationProblems(queued, 'document_ingestion')).toEqual([]);
  });

  it('reports a child that is exported as well', () => {
    // An exported child is a second workflow the
    // app can start by name, and starting one
    // outside its queue is exactly what the queue
    // exists to stop.
    const wrong = queued.replace(
      'const indexPagesQueued =',
      'export const indexPagesQueued =',
    );

    expect(why(registrationProblems(wrong, 'document_ingestion'))).toEqual([
      'the file registers more than one workflow',
    ]);
  });

  it('reports a child under a name outside the grammar', () => {
    const wrong = queued.replace(
      "'index_pages.queued.document_ingestion'",
      "'index_pages.child'",
    );

    expect(why(registrationProblems(wrong, 'document_ingestion'))).toEqual([
      'the file registers more than one workflow',
    ]);
  });

  it('reports a child registered under another workflow', () => {
    // The name is what a reader of the ledger cuts
    // apart to find the block a row belongs to. A
    // child carrying somebody else's workflow name
    // sends every one of its rows to the wrong
    // document.
    const wrong = queued.replace(
      "'index_pages.queued.document_ingestion'",
      "'index_pages.queued.invoice_run'",
    );

    expect(why(registrationProblems(wrong, 'document_ingestion'))).toEqual([
      'the file registers more than one workflow',
    ]);
  });

  it('reports the child function being exported', () => {
    const wrong = queued.replace(
      'async function indexPagesQueuedFn',
      'export async function indexPagesQueuedFn',
    );

    expect(why(registrationProblems(wrong, 'document_ingestion'))).toEqual([
      'indexPagesQueuedFn is exported as well as the registered workflow',
    ]);
  });

  it('still reports the parent when it is the one out of place', () => {
    // The parent is found by the name it registers
    // under rather than by being first: the
    // children are written above it.
    const wrong = queued.replace('export const documentIngestion', 'const b');

    expect(why(registrationProblems(wrong, 'document_ingestion'))).toEqual([
      'the registered workflow is not exported',
    ]);
  });
});

describe('queueProblems', () => {
  const enqueued = [
    'const indexPagesQueued = DBOS.registerWorkflow(indexPagesQueuedFn, {',
    "  name: 'index_pages.queued.document_ingestion',",
    '});',
    '',
    'async function fn(): Promise<void> {',
    '  const handles: WorkflowHandle<Indexed>[] = [];',
    '  for (const item of items) {',
    '    handles.push(',
    '      await DBOS.startWorkflow(indexPagesQueued, {',
    "        queueName: 'document-index',",
    '      })(item),',
    '    );',
    '  }',
    '',
    '  const settled: PromiseSettledResult<Indexed>[] = [];',
    '  for (const handle of handles) {',
    '    try {',
    '      const value = await handle.getResult();',
    "      settled.push({ status: 'fulfilled', value });",
    '    } catch (reason) {',
    "      settled.push({ status: 'rejected', reason });",
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');

  /** The enqueue itself, as the source above
   *  spells it. */
  const enqueue =
    'await DBOS.startWorkflow(indexPagesQueued, {\n        ' +
    "queueName: 'document-index',\n      })(item),";

  it('passes the enqueue and the collection the compiler writes', () => {
    expect(queueProblems(enqueued)).toEqual([]);
  });

  it('reports a run started off no queue', () => {
    // Without a queue name the child starts at
    // once, outside every limit the queue was
    // configured with, and nothing says so.
    const wrong = enqueued.replace(
      enqueue,
      'await DBOS.startWorkflow(indexPagesQueued)(item),',
    );

    expect(why(queueProblems(wrong))).toEqual([
      'the run is started with no queueName, so no queue holds it',
    ]);
  });

  it('reports a run started off something the file never registered', () => {
    const wrong = enqueued.replace(
      'DBOS.startWorkflow(indexPagesQueued, {',
      'DBOS.startWorkflow(indexPage, {',
    );

    expect(why(queueProblems(wrong))).toEqual([
      "indexPage is not registered as a queue block's child",
    ]);
  });

  it('reports a run started off a workflow registered plainly', () => {
    // A queue enqueues workflow executions. A
    // registration under a plain name is a
    // workflow of the app's own, and enqueuing one
    // records rows no block can be found from.
    const wrong = enqueued.replace(
      "'index_pages.queued.document_ingestion'",
      "'index_pages'",
    );

    expect(why(queueProblems(wrong))).toEqual([
      "indexPagesQueued is not registered as a queue block's child",
    ]);
  });

  it('reports a result awaited from inside a step', () => {
    const wrong = [
      'async function fn(): Promise<void> {',
      '  await DBOS.runStep(async () => handle.getResult(), {',
      "    name: 'a',",
      '    retriesAllowed: false,',
      '  });',
      '}',
    ].join('\n');

    expect(why(queueProblems(wrong))).toEqual([
      'getResult() waits on a run and cannot be awaited inside a step',
    ]);
  });

  it('leaves the same wait alone in a workflow body', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  const indexed = await handle.getResult();',
      '}',
    ].join('\n');

    expect(queueProblems(source)).toEqual([]);
  });

  it('reports a child whose name carries more than the region', () => {
    // The name is compared against what renders
    // it, so a region tacked on the end is not a
    // queued name however much it looks like one.
    const wrong = enqueued.replace(
      "'index_pages.queued.document_ingestion'",
      "'index_pages.queued.document_ingestion.clear'",
    );

    expect(why(queueProblems(wrong))).toEqual([
      "indexPagesQueued is not registered as a queue block's child",
    ]);
  });

  it('names what was started, when it is not a binding', () => {
    const wrong = enqueued.replace(
      'DBOS.startWorkflow(indexPagesQueued, {',
      'DBOS.startWorkflow(pick(), {',
    );

    expect(why(queueProblems(wrong))).toEqual([
      "pick() is not registered as a queue block's child",
    ]);
  });

  it('reports a start with nothing to start at all', () => {
    const wrong = enqueued.replace(enqueue, 'DBOS.startWorkflow()(item),');

    expect(why(queueProblems(wrong))).toEqual([
      'the run is started with no queueName, so no queue holds it',
      "the run is not registered as a queue block's child",
    ]);
  });

  it('says nothing about a file that starts no run at all', () => {
    expect(queueProblems('export const a = 1;\n')).toEqual([]);
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

describe('placementProblems', () => {
  it('says nothing about a clock read, which the runtime has to do', () => {
    // A workflow body may not read the clock; the
    // code around it must. An email's link carries
    // an issued time, and something has to supply
    // it.
    const source = [
      'export function nowMs(): number {',
      '  return Date.now();',
      '}',
    ].join('\n');

    expect(placementProblems(source)).toEqual([]);
    expect(why(determinismProblems(source))).toHaveLength(1);
  });

  it('still reports a fan-out that drops what had not settled', () => {
    const source = [
      'export async function all(work: Promise<void>[]): Promise<void> {',
      '  await Promise.all(work);',
      '}',
    ].join('\n');

    expect(why(placementProblems(source))).toEqual([
      'Promise.all drops the results of everything that had not settled',
    ]);
  });

  it('still reports the datasource client outside a transaction', () => {
    const source = [
      'export async function write(): Promise<void> {',
      '  await appDb.client.thing.create({ data: {} });',
      '}',
    ].join('\n');

    expect(why(placementProblems(source))).toEqual([
      'the datasource client only exists inside a transaction',
    ]);
  });

  it('still reports a workflow-only call made from inside a step', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  await DBOS.runStep(async () => DBOS.send("a", 1), {',
      "    name: 'a',",
      '    retriesAllowed: false,',
      '  });',
      '}',
    ].join('\n');

    expect(why(placementProblems(source))).toEqual([
      'DBOS.send() belongs to the workflow, not to a step',
    ]);
  });
});

describe('minting a link', () => {
  it('is reported in a workflow body', () => {
    // A token's issued and expiry times come from
    // the clock, so a replay would mint a
    // different one and the recipient would be
    // holding a link the run no longer knows.
    const source = [
      'async function fn(): Promise<void> {',
      '  const url = mintFormLink({ runId, nodeId });',
      '  const other = mintArtifactLink({ key });',
      '}',
    ].join('\n');

    expect(why(determinismProblems(source))).toEqual([
      'minting a link stamps the clock into it, and a replay would mint a ' +
        'different one',
      'minting a link stamps the clock into it, and a replay would mint a ' +
        'different one',
    ]);
  });

  it('is left alone inside a step, which is where it belongs', () => {
    const source = [
      'async function fn(): Promise<void> {',
      '  await DBOS.runStep(async () => mintFormLink({ runId }), {',
      "    name: 'a',",
      '    retriesAllowed: false,',
      '  });',
      '}',
    ].join('\n');

    expect(determinismProblems(source)).toEqual([]);
  });
});

describe('recordedNameLiterals', () => {
  it('lists every row a compiled approval writes, in source order', () => {
    // The four steps after the decision are on the
    // list as much as the wait's own rows are:
    // what this answers is "what would this file
    // record", and the arms are part of that.
    expect(recordedNameLiterals(golden('approval_flow'))).toEqual([
      "'manager_ok.ask'",
      "'manager_ok.register'",
      'DBOS.recv',
      'DBOS.sleep',
      "'manager_ok.clear'",
      "'pay_claim'",
      "'send_receipt'",
      "'file_refusal'",
      "'close_claim'",
    ]);
  });

  it('leaves out the name the workflow registers under', () => {
    // The last `name:` in that file is the
    // registration's, and a registration records
    // no row. Matching `name:` rather than the
    // call it sits in would put it on the list.
    expect(recordedNameLiterals(golden('approval_flow'))).not.toContain(
      "'approval_flow'",
    );
  });

  it('reads a sleep out of a recv that has no sleep of its own', () => {
    // `recv` reserves two ids and records under
    // both: its own row and the durable sleep that
    // times it out. Nothing in the file says so.
    const source = golden('approval_flow');

    expect(source).not.toContain('DBOS.sleep(');
    expect(recordedNameLiterals(source)).toContain('DBOS.sleep');
  });

  it('hands back the source text, holes and all', () => {
    // A step inside a loop records a different
    // name every round, and the hole is what says
    // which region varies. Flattening it would
    // throw away the only thing that tells a round
    // apart from a reminder.
    expect(recordedNameLiterals(golden('form_retry'))).toEqual([
      '`ask_details.r${round}`',
      '`await_details.r${round}.register`',
      'DBOS.recv',
      'DBOS.sleep',
      '`await_details.r${round}.resend.${awaitDetailsResends}`',
      '`await_details.r${round}.clear`',
      "'record_intake'",
    ]);
  });

  it('counts a transaction and a literal sleep', () => {
    // A transaction records its name the way a
    // step does, and the timer wait is the one
    // golden with a `DBOS.sleep(` of its own.
    expect(recordedNameLiterals(golden('timer_wait'))).toEqual([
      'DBOS.sleep',
      "'record_booking'",
    ]);
    expect(recordedNameLiterals(golden('transaction'))).toEqual([
      "'record_booking'",
    ]);
  });

  it('reads nothing out of the run id, which is a property', () => {
    // `DBOS.workflowID` is read in four goldens
    // and records nothing anywhere. A rule written
    // on the `DBOS.` prefix rather than on the
    // call would put a row on the list for each.
    const source = golden('form_intake');

    expect(source).toContain('DBOS.workflowID');
    expect(recordedNameLiterals(source)).toEqual([
      "'ask_details'",
      "'await_details.register'",
      'DBOS.recv',
      'DBOS.sleep',
      "'await_details.clear'",
      "'record_intake'",
    ]);
  });

  it('reads a result row out of a started run, which no golden has', () => {
    // Written against a source string on purpose:
    // nothing this compiler emits yet starts
    // another run, so there is no golden to read
    // it out of and pretending otherwise would
    // leave the rule untested.
    const source = [
      'async function fn(): Promise<void> {',
      '  const handle = await DBOS.startWorkflow(sendReceipt)(claim);',
      '}',
    ].join('\n');

    expect(recordedNameLiterals(source)).toEqual(['DBOS.getResult']);
  });

  it('names the child a queue block starts, off the registration', () => {
    // Starting a run records the child's own
    // registered name in the parent, and the call
    // site spells the child as a binding — so the
    // registration in the same file is the only
    // way back to the name. Without it the
    // conformance check has nothing to hold the
    // enqueue rows against.
    const source = [
      'const indexPagesQueued = DBOS.registerWorkflow(indexPagesQueuedFn, {',
      "  name: 'index_pages.queued.document_ingestion_queued',",
      '});',
      '',
      'async function fn(): Promise<void> {',
      '  const handle = await DBOS.startWorkflow(indexPagesQueued, {',
      "    queueName: 'document-index',",
      '  })(item);',
      '  const indexed = await handle.getResult();',
      '}',
    ].join('\n');

    expect(recordedNameLiterals(source)).toEqual([
      "'index_pages.queued.document_ingestion_queued'",
      'DBOS.getResult',
    ]);
  });
});

/**
 * The sweep that keeps the widened rules honest.
 *
 * Every rule set is written against a hand-made
 * source, which is what makes each one readable;
 * this is what says the six of them together
 * accept the compiler's real output. A rule that
 * grew a new clause and forgot an old shape reds
 * here and nowhere else.
 */
describe('every blessed compiler output', () => {
  for (const dir of ['compile', 'patterns']) {
    for (const name of goldenNames(dir)) {
      it(`${dir}/${name} reports nothing under any of the six`, () => {
        const source = readFixture(`golden/${dir}/${name}.workflow.ts`);

        expect(determinismProblems(source)).toEqual([]);
        expect(placementProblems(source)).toEqual([]);
        expect(stepProblems(source)).toEqual([]);
        expect(headerProblems(source, name)).toEqual([]);
        expect(registrationProblems(source, name)).toEqual([]);
        expect(queueProblems(source)).toEqual([]);
      });
    }
  }
});
