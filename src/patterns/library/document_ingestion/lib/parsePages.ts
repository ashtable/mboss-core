import type { ParsedDocument, UploadEvent } from './documentIngestionTypes.js';

/**
 * Reads the upload and splits it into pages.
 *
 * Drawn as a code block: it is your parser, and
 * mBoss has no opinion about whether that is a PDF
 * library, a text splitter or a call you already
 * have. Fetch the bytes from the object store with
 * the key on the event — the bytes themselves
 * never travel between blocks.
 *
 * The list this returns is what the next block
 * fans out over, so its length is how many times
 * that block runs.
 */
export async function parsePages(upload: UploadEvent): Promise<ParsedDocument> {
  return {
    uploadId: upload.uploadId,
    pages: [
      { uploadId: upload.uploadId, pageNumber: 1, text: 'The first page.' },
      { uploadId: upload.uploadId, pageNumber: 2, text: 'The second page.' },
    ],
  };
}
