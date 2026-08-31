import { describe, expect, it } from 'vitest';

import type { ScheduleEntry } from './contract.js';
import { applyAndPruneSchedules, type SchedulePort } from './schedules.js';

/**
 * Reconciling the schedules in the database with
 * the schedules in the code.
 *
 * Applying is idempotent and DBOS offers it
 * directly. Pruning it does not: deleting a
 * schedule is a separate call, which is evidence
 * that applying does not remove anything. So
 * without this, deleting a scheduled trigger from
 * a workflow and redeploying leaves the old cron
 * firing a workflow the app no longer exports —
 * and nothing anywhere would say so.
 */

async function nothing(): Promise<void> {}

function entry(scheduleName: string): ScheduleEntry {
  return {
    scheduleName,
    workflowFn: nothing,
    schedule: '0 * * * *',
    cronTimezone: 'Etc/UTC',
    automaticBackfill: false,
  };
}

function recording(existing: string[]) {
  const applied: ScheduleEntry[][] = [];
  const deleted: string[] = [];

  const port: SchedulePort = {
    async applySchedules(entries) {
      applied.push([...entries]);
    },
    async listSchedules() {
      return existing.map((scheduleName) => ({ scheduleName }));
    },
    async deleteSchedule(name) {
      deleted.push(name);
    },
  };

  return { applied, deleted, port };
}

describe('applyAndPruneSchedules', () => {
  it('applies every schedule the code declares', async () => {
    const { applied, port } = recording([]);
    const entries = [entry('nightly'), entry('hourly')];

    await applyAndPruneSchedules(entries, port);

    expect(applied).toEqual([entries]);
  });

  it('deletes a schedule the code no longer declares', async () => {
    const { deleted, port } = recording(['nightly', 'retired']);

    await applyAndPruneSchedules([entry('nightly')], port);

    expect(deleted).toEqual(['retired']);
  });

  it('leaves a schedule that is in both alone', async () => {
    const { deleted, port } = recording(['nightly']);

    await applyAndPruneSchedules([entry('nightly')], port);

    expect(deleted).toEqual([]);
  });

  it('deletes nothing when the code declares nothing and neither did it', async () => {
    const { applied, deleted, port } = recording([]);

    await applyAndPruneSchedules([], port);

    expect(applied).toEqual([[]]);
    expect(deleted).toEqual([]);
  });

  it('removes every leftover when the last schedule goes', async () => {
    // The case that matters most: a workflow whose
    // schedule trigger was deleted outright.
    const { deleted, port } = recording(['nightly', 'hourly']);

    await applyAndPruneSchedules([], port);

    expect(deleted.sort()).toEqual(['hourly', 'nightly']);
  });

  it('applies before it prunes, so a rename is never a gap', async () => {
    const order: string[] = [];
    const port: SchedulePort = {
      async applySchedules() {
        order.push('apply');
      },
      async listSchedules() {
        return [{ scheduleName: 'retired' }];
      },
      async deleteSchedule() {
        order.push('delete');
      },
    };

    await applyAndPruneSchedules([entry('nightly')], port);

    expect(order).toEqual(['apply', 'delete']);
  });
});
