// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { DBOS } from '@dbos-inc/dbos-sdk';

import type { QueueEntry } from './contract.js';

/**
 * The queues the generated registry declares, and
 * the key one item is queued under.
 *
 * A queue's configuration lives in the system
 * database, so registering it is a call rather
 * than a declaration, and it has to happen on
 * every boot: the row belongs to the deployment
 * that wrote it, and a rolling deploy is two of
 * them.
 */

/**
 * The one call this needs, so registering can be
 * tested without a database. The default is DBOS
 * itself.
 */
export type QueuePort = {
  registerQueue(name: string, options: QueueEntry['options']): Promise<unknown>;
};

/**
 * Registers every queue the registry declares.
 *
 * Never deletes one, which is where this parts
 * company with the schedules beside it. A schedule
 * nobody declares goes on firing, so it has to be
 * pruned; a queue nobody enqueues to does nothing,
 * and deleting one strands the rows already
 * sitting on it.
 *
 * One at a time, in the order the registry lists
 * them, so a failure names the queue it happened
 * on rather than one of several in flight.
 */
export async function registerQueues(
  entries: readonly QueueEntry[],
  dbos: QueuePort = DBOS,
): Promise<void> {
  for (const entry of entries) {
    await dbos.registerQueue(entry.name, entry.options);
  }
}

/**
 * The key one item is queued under.
 *
 * Throws rather than passing an empty string on: a
 * partitioned queue never dequeues a row with no
 * key, so a missing key is a run that waits for
 * ever with nothing said. The block and the path
 * are in the message because the item it was read
 * off is not somewhere a reader can look.
 */
export function queueKey(nodeId: string, path: string, value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${nodeId}: ${path} is missing on an item.`);
  }

  return value;
}
