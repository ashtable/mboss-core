import type {
  EmbeddedPage,
  IngestionSummary,
} from './documentIngestionTypes.js';

/**
 * Records the finished upload, once, after every
 * page is in.
 *
 * It takes the whole array. The block before it
 * declares what one page's result is, and the
 * value that reaches this one is a list of those —
 * so this signature is an array where the drawing
 * shows a single name, and that is on purpose.
 *
 * Writes nothing, because a project on its first
 * day has no table to write to. Once you have one,
 * write it through `appDb.client` from
 * `src/app/db.ts`, so the rows and the run's own
 * checkpoint commit together or neither does. What
 * must not go here is a call to another service: a
 * transaction is a database write and nothing
 * else, and the canvas refuses a transaction whose
 * handler makes one.
 */
export async function finalizeIngestion(
  pages: EmbeddedPage[],
): Promise<IngestionSummary> {
  return {
    uploadId: pages[0]?.uploadId ?? '',
    pagesEmbedded: pages.length,
  };
}
