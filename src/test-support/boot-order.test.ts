import { describe, expect, it } from 'vitest';

import { bootProblems, callsInOrder } from './boot-order.js';

/**
 * The auditor, before anything trusts it.
 *
 * It exists to answer two questions about a boot
 * sequence — did this call happen before that one,
 * and did anything wait for it — and neither a
 * type-check nor a golden can see either answer. So
 * the reading is pinned here against sources whose
 * order is not in doubt.
 */

/** The reading the ordering tests care about. */
const callNamesInOrder = (source: string): string[] =>
  callsInOrder(source).map((call) => call.name);

describe('callsInOrder', () => {
  it('reads a plain sequence in the order it is written', () => {
    const names = callNamesInOrder(`
      first();
      second();
      third();
    `);

    expect(names).toEqual(['first', 'second', 'third']);
  });

  it('takes the last name of a qualified call', () => {
    const names = callNamesInOrder(`
      PrismaDataSource.initializeDBOSSchema(prisma);
      DBOS.launch();
    `);

    expect(names).toEqual(['initializeDBOSSchema', 'launch']);
  });

  it('sees calls inside a function, which is where a boot lives', () => {
    const names = callNamesInOrder(`
      async function main() {
        await DBOS.launch();
        app.listen(3000, '0.0.0.0');
      }
      void main();
    `);

    expect(names).toEqual(['launch', 'listen', 'main']);
  });

  it('reports a reordering, which is the whole point', () => {
    const listenFirst = callNamesInOrder(`
      app.listen(3000);
      await DBOS.launch();
    `);

    expect(listenFirst.indexOf('listen')).toBeLessThan(
      listenFirst.indexOf('launch'),
    );
  });

  it('records every occurrence, not only the first', () => {
    expect(callNamesInOrder('a(); b(); a();')).toEqual(['a', 'b', 'a']);
  });

  it('says nothing about a file that calls nothing', () => {
    expect(callNamesInOrder('export const x = 1;')).toEqual([]);
  });

  it('reads a call written as an argument to another', () => {
    expect(callNamesInOrder('outer(inner());')).toEqual(['outer', 'inner']);
  });

  it('records whether each call was waited for', () => {
    expect(callsInOrder('await one(); two();')).toEqual([
      { name: 'one', awaited: true },
      { name: 'two', awaited: false },
    ]);
  });

  it('does not read a deliberately discarded promise as awaited', () => {
    // `void x()` is how this house says "start it
    // and move on", which is the opposite of what
    // a boot step needs.
    expect(callsInOrder('void one();')).toEqual([
      { name: 'one', awaited: false },
    ]);
  });
});

const GOOD = `
  async function main() {
    const env = readEnv(process.env);
    DBOS.setConfig({ name: 'app' });
    await PrismaDataSource.initializeDBOSSchema(prisma());
    await DBOS.launch();
    await registerQueues(queues);
    await applyAndPruneSchedules(schedules);
    app.listen(env.PORT, '0.0.0.0');
  }
`;

describe('bootProblems', () => {
  it('says nothing about a boot in the right order', () => {
    expect(bootProblems(GOOD)).toEqual([]);
  });

  it('reports a listener opened before launch resolves', () => {
    const source = GOOD.replace(
      'await DBOS.launch();',
      'app.listen(1); await DBOS.launch();',
    );

    // Two, because a listener that far up is also
    // above the queue registration: a request that
    // starts a run in that window enqueues onto a
    // queue no row exists for yet.
    expect(bootProblems(source)).toEqual([
      'listens before DBOS.launch() resolves',
      'registers queues after it listens',
    ]);
  });

  it('reports queues registered before launch resolves', () => {
    // `DBOS.registerQueue` waits for the launch
    // that owns the connection it writes through,
    // so a registration above it throws instead of
    // registering anything.
    const source = GOOD.replace(
      'await DBOS.launch();\n    await registerQueues(queues);',
      'await registerQueues(queues);\n    await DBOS.launch();',
    );

    expect(bootProblems(source)).toEqual([
      'registers queues before DBOS.launch() resolves',
    ]);
  });

  it('reports queues registered after the listener is open', () => {
    const source = GOOD.replace(
      'await registerQueues(queues);\n    await applyAndPruneSchedules(' +
        "schedules);\n    app.listen(env.PORT, '0.0.0.0');",
      "app.listen(env.PORT, '0.0.0.0');\n    await registerQueues(queues);" +
        '\n    await applyAndPruneSchedules(schedules);',
    );

    expect(bootProblems(source)).toEqual(['registers queues after it listens']);
  });

  it('reports queues registered after the schedules are applied', () => {
    // A scheduled run may enqueue the moment its
    // schedule is applied, and a row enqueued onto
    // a queue with no configuration waits with
    // nothing said.
    const source = GOOD.replace(
      'await registerQueues(queues);\n    await applyAndPruneSchedules(' +
        'schedules);',
      'await applyAndPruneSchedules(schedules);\n    await registerQueues(' +
        'queues);',
    );

    expect(bootProblems(source)).toEqual([
      'registers queues after the schedules are applied',
    ]);
  });

  it('reports a queue registration nothing waits for', () => {
    const source = GOOD.replace(
      'await registerQueues(queues);',
      'void registerQueues(queues);',
    );

    expect(bootProblems(source)).toEqual([
      'does not await the queue registration',
    ]);
  });

  it('reports a datasource schema created after launch', () => {
    const source = `
      await DBOS.launch();
      await PrismaDataSource.initializeDBOSSchema(prisma());
      app.listen(1);
    `;

    expect(bootProblems(source)).toEqual([
      'creates the datasource schema after DBOS.launch()',
    ]);
  });

  it('reports a launch nothing waits for', () => {
    // The order is still right and the listener
    // still comes last, but the listener opens
    // while launch is only started — which is the
    // failure the ordering rule exists to prevent.
    const source = GOOD.replace('await DBOS.launch();', 'DBOS.launch();');

    expect(bootProblems(source)).toEqual(['does not await DBOS.launch()']);
  });

  it('reports a schema creation nothing waits for', () => {
    const source = GOOD.replace(
      'await PrismaDataSource.initializeDBOSSchema(prisma());',
      'void PrismaDataSource.initializeDBOSSchema(prisma());',
    );

    expect(bootProblems(source)).toEqual([
      'does not await the datasource schema creation',
    ]);
  });

  it('reports each of the three calls when it is missing altogether', () => {
    expect(bootProblems('void 0;')).toEqual([
      'never creates the datasource schema',
      'never calls DBOS.launch()',
      'never listens',
    ]);
  });
});
