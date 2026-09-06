import type { DocumentPage, EmbeddedPage } from './documentIngestionTypes.js';

/**
 * Turns one page into a vector.
 *
 * One page in, one result out: the block fans out
 * over the pages and calls this once for each,
 * with its own checkpoint, so a page that fails is
 * retried on its own and the pages that succeeded
 * are not embedded again.
 *
 * Put your provider's embedding call here. The
 * stand-in returns a fixed vector so a project
 * created today runs end to end.
 */
export async function embedPage(page: DocumentPage): Promise<EmbeddedPage> {
  return {
    uploadId: page.uploadId,
    pageNumber: page.pageNumber,
    vector: [0, 0, 0],
  };
}
