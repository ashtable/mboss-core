import type { Page, ParsedPdf, Pdf } from './documentIngestionQueuedTypes.js';

/**
 * Splits the file into pages.
 *
 * Drawn as a code block: it is your parser, and
 * mBoss has no opinion about whether that is a PDF
 * library, a text splitter or something you
 * already have.
 *
 * The list this returns is what the block below
 * fans out over, so its length is how many runs
 * that block starts. The stand-in returns one page
 * for every page the upload said it had, so a
 * project created today has something to count.
 */
export async function parsePdf(pdf: Pdf): Promise<ParsedPdf> {
  const pages: Page[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.pageCount; pageNumber += 1) {
    pages.push({
      documentId: pdf.documentId,
      pageNumber,
      text: `Page ${pageNumber}.`,
    });
  }

  return { documentId: pdf.documentId, pages };
}
