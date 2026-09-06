import type { WorkBatch } from './scheduledOpsTypes.js';

/**
 * Finds the jobs that have come due.
 *
 * It takes no argument, and cannot: a run the
 * clock started carries no payload, so everything
 * this needs it has to go and find.
 *
 * Reading the clock here is fine and reading it in
 * the workflow itself is not. This runs as a step,
 * so the moment it settled on is checkpointed — a
 * run recovered an hour later works from the same
 * instant it did the first time rather than
 * quietly picking up a different set of jobs.
 */
export async function listWork(): Promise<WorkBatch> {
  return {
    dueBefore: new Date().toISOString(),
    items: [],
  };
}
