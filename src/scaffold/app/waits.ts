// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { randomUUID } from 'node:crypto';

import type { WaitRegistration } from './contract.js';
import { prismaClient } from './db.js';

/**
 * Which run is parked on which node, and what will
 * wake it.
 *
 * This is the one table this app owns for itself.
 * Everything a workflow remembers between blocks
 * is DBOS's business; this exists because an event
 * arriving from outside, or a person submitting a
 * form, knows a phone number or a node id and not
 * a run id. A row is written just before the run
 * goes to sleep and deleted as soon as it wakes,
 * so a row that is present means a run that is
 * genuinely still waiting.
 *
 * The writes go through an ordinary client rather
 * than through the DBOS datasource, and that is
 * deliberate: the generated workflow calls these
 * from inside a step, and a transaction inside a
 * step is a step inside a step. Durability comes
 * from the step around the call, and both writes
 * below are safe to repeat, which is what a
 * retried step needs of them.
 */

export type WaitRow = {
  runId: string;
  nodeId: string;
  topic: string;
  key: string;
  /**
   * Which occasion of waiting this row is.
   *
   * A wait inside a loop parks on the same node
   * every round, and what wakes a run carries an
   * idempotency key so that a webhook delivered
   * twice lands once. DBOS makes that key the
   * primary key of its message table and marks a
   * consumed message rather than deleting it, so a
   * key built from the run and the node alone
   * would work for the first round and be silently
   * dropped for every round after it. This is the
   * part of the key that changes.
   */
  park: string;
};

/**
 * The four things this module asks of a database,
 * so that its own semantics can be tested without
 * one. The default below is the real table.
 */
export type WaitStore = {
  put(row: WaitRow): Promise<void>;
  remove(runId: string, nodeId: string): Promise<void>;
  matching(topic: string, key: string): Promise<WaitRow[]>;
  get(runId: string, nodeId: string): Promise<WaitRow | null>;
};

export function prismaWaitStore(): WaitStore {
  const table = (): ReturnType<typeof prismaClient>['waitCorrelation'] =>
    prismaClient().waitCorrelation;

  return {
    async put(row) {
      // An upsert rather than a create: the step
      // around this one is retried, and the run
      // and node are the primary key.
      await table().upsert({
        where: { runId_nodeId: { runId: row.runId, nodeId: row.nodeId } },
        create: row,
        update: { topic: row.topic, key: row.key, park: row.park },
      });
    },
    async remove(runId, nodeId) {
      // `deleteMany` rather than `delete`: deleting
      // a row that has already gone is not an
      // error, and a retried clear is ordinary.
      await table().deleteMany({ where: { runId, nodeId } });
    },
    async matching(topic, key) {
      return table().findMany({ where: { topic, key } });
    },
    async get(runId, nodeId) {
      return table().findUnique({ where: { runId_nodeId: { runId, nodeId } } });
    },
  };
}

/**
 * Writing the row a wake is addressed by.
 *
 * A run already parked here keeps the park it
 * has: the step around this call is retried, and a
 * retry that minted a second park would let a
 * delivery that read the first and one that read
 * the second both land, which is the double wake
 * the key exists to prevent. A run parking here
 * again after clearing gets a new one, because
 * that is a new occasion of waiting.
 */
export async function registerWaitCorrelation(
  registration: WaitRegistration,
  store: WaitStore = prismaWaitStore(),
): Promise<void> {
  const parked = await store.get(registration.runId, registration.nodeId);

  await store.put({ ...registration, park: parked?.park ?? randomUUID() });
}

export async function clearWaitCorrelation(
  runId: string,
  nodeId: string,
  store: WaitStore = prismaWaitStore(),
): Promise<void> {
  await store.remove(runId, nodeId);
}

/**
 * Which run an arriving event should wake.
 *
 * Two runs can legitimately be parked on the same
 * key — two people booking with the same phone
 * number, say — and which of them an event wakes
 * is arbitrary. It must not be arbitrary
 * *differently* on each delivery, though, or a
 * redelivered webhook lands on a different run
 * than the first one did, so the ordering is fixed
 * here rather than left to the database.
 */
export async function findWaitCorrelation(
  topic: string,
  key: string,
  store: WaitStore = prismaWaitStore(),
): Promise<{ runId: string; nodeId: string; park: string } | null> {
  const rows = [...(await store.matching(topic, key))].sort((a, b) =>
    a.runId < b.runId ? -1 : 1,
  );
  const first = rows[0];

  return first
    ? { runId: first.runId, nodeId: first.nodeId, park: first.park }
    : null;
}

/**
 * Which park this run is on, or null when it is
 * not waiting here at all.
 *
 * Asked per run, and that is the whole point.
 * Every run waiting on a form node registers the
 * same key, so a lookup by topic and key would
 * answer "somebody is still waiting" for a link
 * whose own run answered days ago.
 */
export async function parkOf(
  runId: string,
  nodeId: string,
  store: WaitStore = prismaWaitStore(),
): Promise<string | null> {
  return (await store.get(runId, nodeId))?.park ?? null;
}
