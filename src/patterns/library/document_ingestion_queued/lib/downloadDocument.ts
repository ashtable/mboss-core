import type { DocumentUploaded, Pdf } from './documentIngestionQueuedTypes.js';

/**
 * Fetches the uploaded file.
 *
 * Drawn as a step, because that is what a call out
 * to another service is: it checkpoints, so a run
 * recovered after the download has already
 * happened does not fetch the file again.
 *
 * What it returns is where the file is and how
 * long it is, never the bytes. Fetch those from
 * the object store with the key, in whichever
 * block needs them.
 */
export async function downloadDocument(upload: DocumentUploaded): Promise<Pdf> {
  return {
    documentId: upload.documentId,
    storageKey: upload.storageKey,
    pageCount: upload.pageCount,
  };
}
