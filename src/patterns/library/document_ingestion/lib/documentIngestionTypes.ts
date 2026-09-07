/**
 * The payloads the ingestion workflow wires its
 * blocks together with.
 *
 * A page carries its own `uploadId` even though
 * the document it came from already has one. The
 * embedding block runs once per page and is handed
 * that page and nothing else, so anything its
 * handler needs has to be on the item.
 */

/** An upload waiting to be read. */
export interface UploadEvent {
  uploadId: string;
  filename: string;
  contentType: string;
  storageKey: string;
}

/** One page, as the parser pulled it out. */
export interface DocumentPage {
  uploadId: string;
  pageNumber: number;
  text: string;
}

/** The whole upload, split into pages. */
export interface ParsedDocument {
  uploadId: string;
  pages: DocumentPage[];
}

/** One page with its vector alongside it. */
export interface EmbeddedPage {
  uploadId: string;
  pageNumber: number;
  vector: number[];
}

/** What the run recorded once every page was in. */
export interface IngestionSummary {
  uploadId: string;
  pagesEmbedded: number;
}
