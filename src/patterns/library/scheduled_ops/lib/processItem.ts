import type { WorkItem, WorkResult } from './scheduledOpsTypes.js';

/**
 * Does one job and marks it done.
 *
 * One job in, one result out: the block fans out
 * over the batch and runs this once per job, each
 * inside its own database transaction. So a job
 * that fails leaves its own row untouched and is
 * the only one retried — and marking it done is
 * part of the same transaction as the work, which
 * is what stops the next sweep picking it up
 * again.
 *
 * Writes nothing, because a project on its first
 * day has no job table to write to. Once you have
 * one, write it through `appDb.client` from
 * `src/app/db.ts`. What must not go here is a call
 * to another service: a transaction is a database
 * write and nothing else, and the canvas refuses a
 * transaction whose handler makes one. If the work
 * really is a call out, draw the block as a step
 * instead.
 */
export async function processItem(item: WorkItem): Promise<WorkResult> {
  return { jobId: item.jobId, done: true };
}
