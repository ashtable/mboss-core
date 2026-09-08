import type { IndexResult, Page } from './documentIngestionQueuedTypes.js';

/**
 * Indexes one page.
 *
 * One page in, one result out. The block above
 * runs this on a queue, so each page is a run of
 * its own: started under the queue's limits,
 * recorded on its own row, and recovered on its
 * own if the process it was running in went away.
 * The queue is what stops a hundred uploads at
 * once from becoming a hundred concurrent calls to
 * whatever you index into.
 *
 * The block deduplicates items on the page's
 * `documentId`, and every page of one document
 * carries the same one: a page offered while
 * another page of that document is still in flight
 * joins the run already going rather than starting
 * a second, and its result is that run's.
 * Deduplicate on something each item has its own
 * of — the page number, say — to index every page
 * on its own.
 *
 * Put your search or vector store's write here.
 * The stand-in reports one chunk so a project
 * created today runs end to end.
 */
export async function indexPage(page: Page): Promise<IndexResult> {
  return {
    documentId: page.documentId,
    pageNumber: page.pageNumber,
    chunks: 1,
  };
}
