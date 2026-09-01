// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { DBOS } from '@dbos-inc/dbos-sdk';

import type { ScheduleEntry } from './contract.js';

/**
 * Bringing the schedules in the database into line
 * with the schedules in the code.
 *
 * Applying is idempotent, so it is safe on every
 * boot. Pruning is the half nothing does for you:
 * deleting a schedule is a separate call, which is
 * how you can tell that applying does not remove
 * anything. Without the pruning below, deleting a
 * scheduled trigger from a workflow and
 * redeploying leaves the old cron firing a
 * workflow the registry no longer exports, and
 * nothing anywhere says so.
 *
 * This app owns its whole system database, so
 * every schedule in that table is one of these
 * and there is nothing else to be careful of.
 */

/**
 * The three calls this needs, so the reconciling
 * can be tested without a database. The default is
 * DBOS itself.
 */
export type SchedulePort = {
  /** A plain array, not a readonly one: that is
   *  what the SDK's own method takes, and the
   *  default below is the SDK. */
  applySchedules(entries: ScheduleEntry[]): Promise<void>;
  listSchedules(): Promise<{ scheduleName: string }[]>;
  deleteSchedule(name: string): Promise<void>;
};

export async function applyAndPruneSchedules(
  entries: readonly ScheduleEntry[],
  dbos: SchedulePort = DBOS,
): Promise<void> {
  // Apply first. A schedule that was renamed is
  // then created before its old name is removed,
  // so there is no window in which neither exists.
  await dbos.applySchedules([...entries]);

  const declared = new Set(entries.map((entry) => entry.scheduleName));
  const existing = await dbos.listSchedules();

  for (const schedule of existing) {
    if (declared.has(schedule.scheduleName)) continue;
    await dbos.deleteSchedule(schedule.scheduleName);
  }
}
