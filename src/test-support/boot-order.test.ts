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

    expect(bootProblems(source)).toEqual([
      'listens before DBOS.launch() resolves',
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
