/**
 * The payloads the ingestion workflow wires its
 * blocks together with.
 *
 * A page carries its document's id even though the
 * upload event already had one. The indexing block
 * starts a run of its own per page and hands that
 * run the page and nothing else, so anything its
 * handler needs — and anything the queue keys
 * items by — has to be on the item.
 */

/** A document somebody has just put in. */
export interface DocumentUploaded {
  documentId: string;
  filename: string;
  storageKey: string;
  pageCount: number;
  requestedBy: string;
}

/** The file, as where to find it rather than as
 *  its bytes: every value handed from one block to
 *  the next is written to the database, and a PDF
 *  has no business in there. */
export interface Pdf {
  documentId: string;
  storageKey: string;
  pageCount: number;
}

/** One page, as the parser pulled it out. */
export interface Page {
  documentId: string;
  pageNumber: number;
  text: string;
}

/** The whole file, split into pages. */
export interface ParsedPdf {
  documentId: string;
  pages: Page[];
}

/** What indexing one page came to. */
export interface IndexResult {
  documentId: string;
  pageNumber: number;
  chunks: number;
}

/** What the run recorded once every page was in. */
export interface IngestedDocument {
  documentId: string;
  pagesIndexed: number;
}
