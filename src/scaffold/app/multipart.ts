// Written by mBoss when this project was created.
// It is yours now — edit it freely.

/**
 * Reading a `multipart/form-data` post.
 *
 * This is here rather than taken from a package
 * because a form that accepts a file is the only
 * place this app meets one, and the format is a
 * handful of delimiters. A dependency for it would
 * be carried by every project mBoss makes, for
 * this.
 *
 * It works on bytes throughout. A file part is
 * handed to the object store exactly as it
 * arrived, and anything that decoded it as text on
 * the way through would corrupt every upload that
 * was not text.
 *
 * The whole body is in memory. That is the right
 * shape for the forms this serves — a few
 * documents — and the wrong shape for large files;
 * the limit is set where the route reads the body,
 * so it refuses one rather than running out of
 * memory over it.
 */

export type MultipartPart =
  | { kind: 'field'; name: string; value: string }
  | {
      kind: 'file';
      name: string;
      /** Empty when a file input was left unset,
       *  which browsers still post a part for. */
      filename: string;
      contentType: string;
      body: Uint8Array;
    };

const CRLF = '\r\n';
const HEADER_END = '\r\n\r\n';

/**
 * The boundary a request announced, or null when
 * the request is not a multipart one.
 */
export function boundaryOf(contentType: string | undefined): string | null {
  if (contentType === undefined) return null;
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) return null;

  const found = /boundary="?([^";]+)"?/i.exec(contentType);

  return found?.[1] ?? null;
}

export function parseMultipart(
  body: Uint8Array,
  boundary: string,
): MultipartPart[] {
  const buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const delimiter = Buffer.from(`--${boundary}`, 'binary');
  const marks: number[] = [];

  for (let at = buffer.indexOf(delimiter); at !== -1;) {
    marks.push(at);
    at = buffer.indexOf(delimiter, at + delimiter.length);
  }

  const parts: MultipartPart[] = [];

  for (let index = 0; index + 1 < marks.length; index += 1) {
    const opens = (marks[index] as number) + delimiter.length + CRLF.length;
    // The delimiter that closes a part is preceded
    // by the CRLF that is not part of its body.
    const closes = (marks[index + 1] as number) - CRLF.length;
    if (closes <= opens) continue;

    const part = readPart(buffer.subarray(opens, closes));
    if (part) parts.push(part);
  }

  return parts;
}

/** One part, headers and all, without the
 *  delimiters around it. */
function readPart(raw: Buffer): MultipartPart | null {
  const split = raw.indexOf(HEADER_END);
  if (split === -1) return null;

  const headers = headersOf(raw.subarray(0, split).toString('utf8'));
  const body = raw.subarray(split + HEADER_END.length);
  const disposition = headers['content-disposition'] ?? '';

  const name = quoted(disposition, 'name');
  // A part that names no field cannot be put
  // anywhere, so it is dropped rather than guessed
  // at.
  if (name === null) return null;

  const filename = quoted(disposition, 'filename');
  if (filename === null) {
    return { kind: 'field', name, value: body.toString('utf8') };
  }

  return {
    kind: 'file',
    name,
    filename,
    contentType: headers['content-type'] ?? 'application/octet-stream',
    body: new Uint8Array(body),
  };
}

function headersOf(text: string): Record<string, string> {
  const found: Record<string, string> = {};

  for (const line of text.split(CRLF)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    found[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }

  return found;
}

/**
 * `name="value"` out of a content-disposition
 * header. An empty value is a real answer — an
 * unset file input posts `filename=""` — so this
 * returns null only when the parameter is absent.
 *
 * The parameter has to start a parameter, not sit
 * inside one: `name` also appears inside
 * `filename`, and the two may be written in either
 * order. Reading the wrong one names the field
 * after the file and loses the upload without
 * anything failing.
 */
function quoted(header: string, parameter: string): string | null {
  const found = new RegExp(`(?:^|;)\\s*${parameter}="([^"]*)"`).exec(header);

  return found?.[1] ?? null;
}
