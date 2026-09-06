/**
 * The payloads the sweep workflow wires its blocks
 * together with.
 *
 * Nothing here comes in from outside. The clock
 * starts this workflow, so there is no event and
 * no payload: the first block takes no argument at
 * all, and everything below is worked out from
 * what it found.
 */

/** One job the sweep found waiting. */
export interface WorkItem {
  jobId: string;
  kind: string;
  dueAt: string;
}

/** Everything that was due, and the moment the
 *  sweep asked. */
export interface WorkBatch {
  dueBefore: string;
  items: WorkItem[];
}

/** What one job came to. */
export interface WorkResult {
  jobId: string;
  done: boolean;
}
