import { describe, expect, it } from 'vitest';

import {
  clearWaitCorrelation,
  findWaitCorrelation,
  parkOf,
  registerWaitCorrelation,
  type WaitRow,
  type WaitStore,
} from './waits.js';

/**
 * Which run is parked on which node, and what will
 * wake it.
 *
 * This is the one table a generated app owns for
 * itself. Everything a workflow remembers between
 * blocks is DBOS's; this exists so that an event
 * arriving from outside, or a form somebody
 * submits, can find the run that is waiting for
 * it — neither of which knows a run id.
 *
 * The store is a parameter with a Prisma-backed
 * default, so these tests are the semantics rather
 * than the SQL.
 */

/** The table, in memory, keyed the way the real
 *  one is. */
function memoryStore(rows: WaitRow[] = []): WaitStore {
  const keyOf = (runId: string, nodeId: string): string => `${runId}|${nodeId}`;
  const table = new Map(rows.map((row) => [keyOf(row.runId, row.nodeId), row]));

  return {
    async put(row) {
      table.set(keyOf(row.runId, row.nodeId), row);
    },
    async remove(runId, nodeId) {
      table.delete(keyOf(runId, nodeId));
    },
    async matching(topic, key) {
      return [...table.values()].filter(
        (row) => row.topic === topic && row.key === key,
      );
    },
    async get(runId, nodeId) {
      return table.get(keyOf(runId, nodeId)) ?? null;
    },
  };
}

describe('registering a wait', () => {
  it('records the run, the node, and what will wake it', async () => {
    const store = memoryStore();

    await registerWaitCorrelation(
      {
        runId: 'wf_1',
        nodeId: 'await_reply',
        topic: 'twilio.reply',
        key: '+15551234',
      },
      store,
    );

    expect(await store.get('wf_1', 'await_reply')).toEqual({
      runId: 'wf_1',
      nodeId: 'await_reply',
      topic: 'twilio.reply',
      key: '+15551234',
      park: expect.any(String),
    });
  });

  it('is safe to run twice, because the step around it may be', async () => {
    // A step is retried, and a retried
    // registration must not be a second row or a
    // unique-constraint failure.
    const store = memoryStore();
    const registration = {
      runId: 'wf_1',
      nodeId: 'await_reply',
      topic: 'twilio.reply',
      key: '+15551234',
    };

    await registerWaitCorrelation(registration, store);
    const first = await store.get('wf_1', 'await_reply');
    await registerWaitCorrelation(registration, store);

    expect(await store.matching('twilio.reply', '+15551234')).toHaveLength(1);
    // And it is the same park. A retry that minted
    // a second one would leave a delivery that
    // read the first still able to land beside a
    // delivery that read the second.
    expect((await store.get('wf_1', 'await_reply'))?.park).toBe(first?.park);
  });

  it('gives a run that parks here again a park of its own', async () => {
    // A wait inside a loop parks on the same node
    // every round. DBOS makes the idempotency key
    // of a wake the primary key of its message
    // table and never deletes the row, so a round
    // whose wake carried the last round's key
    // would have its answer dropped and would wait
    // out its timeout instead.
    const store = memoryStore();
    const registration = {
      runId: 'wf_1',
      nodeId: 'await_reply',
      topic: 'twilio.reply',
      key: '+15551234',
    };

    await registerWaitCorrelation(registration, store);
    const first = await store.get('wf_1', 'await_reply');
    await clearWaitCorrelation('wf_1', 'await_reply', store);
    await registerWaitCorrelation(registration, store);
    const second = await store.get('wf_1', 'await_reply');

    expect(first?.park).toEqual(expect.any(String));
    expect(second?.park).not.toBe(first?.park);
  });
});

describe('clearing a wait', () => {
  it('removes the row the run was found by', async () => {
    const store = memoryStore([
      { runId: 'wf_1', nodeId: 'n', topic: 't', key: 'k', park: 'p' },
    ]);

    await clearWaitCorrelation('wf_1', 'n', store);

    expect(await store.get('wf_1', 'n')).toBeNull();
  });

  it('says nothing when there was nothing to clear', async () => {
    // A wait that timed out clears too, and a
    // retried clear runs against a row that has
    // already gone.
    await expect(
      clearWaitCorrelation('wf_1', 'n', memoryStore()),
    ).resolves.toBeUndefined();
  });
});

describe('finding the run an event should wake', () => {
  it('answers with the run and node parked on that topic and key', async () => {
    const store = memoryStore([
      { runId: 'wf_1', nodeId: 'await_reply', topic: 't', key: 'k', park: 'p' },
    ]);

    expect(await findWaitCorrelation('t', 'k', store)).toEqual({
      runId: 'wf_1',
      nodeId: 'await_reply',
      park: 'p',
    });
  });

  it('answers null when nothing is waiting for it', async () => {
    const store = memoryStore([
      { runId: 'wf_1', nodeId: 'await_reply', topic: 't', key: 'k', park: 'p' },
    ]);

    expect(await findWaitCorrelation('t', 'other', store)).toBeNull();
    expect(await findWaitCorrelation('other', 'k', store)).toBeNull();
  });

  it('resolves a tie the same way twice', async () => {
    // Two runs can be parked on one key. Which one
    // an event wakes is arbitrary, but it must not
    // be arbitrary differently on each delivery.
    const store = memoryStore([
      { runId: 'wf_9', nodeId: 'n', topic: 't', key: 'k', park: 'p9' },
      { runId: 'wf_2', nodeId: 'n', topic: 't', key: 'k', park: 'p2' },
    ]);

    expect(await findWaitCorrelation('t', 'k', store)).toEqual({
      runId: 'wf_2',
      nodeId: 'n',
      park: 'p2',
    });
  });
});

describe('asking which park one run is on', () => {
  const store = memoryStore([
    {
      runId: 'wf_1',
      nodeId: 'await_form',
      topic: 'form',
      key: 'await_form',
      park: 'p1',
    },
    {
      runId: 'wf_2',
      nodeId: 'await_form',
      topic: 'form',
      key: 'await_form',
      park: 'p2',
    },
  ]);

  it('answers with the park while its own row is there', async () => {
    expect(await parkOf('wf_1', 'await_form', store)).toBe('p1');
  });

  it('is null once that run answered, though others have not', async () => {
    // This is the whole reason the question is
    // asked per run. Every run parked on a form
    // node registers the same key, so a lookup by
    // topic and key would answer "somebody is
    // waiting" for a link whose own run answered
    // days ago.
    await clearWaitCorrelation('wf_1', 'await_form', store);

    expect(await parkOf('wf_1', 'await_form', store)).toBeNull();
    expect(await parkOf('wf_2', 'await_form', store)).toBe('p2');
  });
});
