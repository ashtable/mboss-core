import { describe, expect, it } from 'vitest';

import { bootProblems, callNamesInOrder } from './boot-order.js';

/**
 * The auditor, before anything trusts it.
 *
 * It exists to answer one question about a boot
 * sequence — did this call happen before that one
 * — and neither a type-check nor a golden can see
 * the answer. So the reading is pinned here
 * against sources whose order is not in doubt.
 */

describe('callNamesInOrder', () => {
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

  it('reports each of the three calls when it is missing altogether', () => {
    expect(bootProblems('void 0;')).toEqual([
      'never creates the datasource schema',
      'never calls DBOS.launch()',
      'never listens',
    ]);
  });
});
