import { describe, expect, it } from 'vitest';

import { boundaryOf, parseMultipart } from './multipart.js';

/**
 * Reading a browser's `multipart/form-data` post.
 *
 * Hand-written, and small enough to read in one
 * sitting, because a form that takes a file is the
 * only place this app parses one and a package for
 * it would be a dependency carried by every
 * project mBoss makes.
 *
 * The bytes matter here: a file part's body is
 * passed through to the object store untouched,
 * and anything that trimmed or re-encoded it would
 * corrupt every upload that was not text.
 */

const BOUNDARY = '----mbossTestBoundary';

/** A body the way a browser writes one. */
function body(parts: string[]): Uint8Array {
  const text = parts
    .map((part) => `--${BOUNDARY}\r\n${part}\r\n`)
    .concat(`--${BOUNDARY}--\r\n`)
    .join('');

  return new Uint8Array(Buffer.from(text, 'binary'));
}

describe('boundaryOf', () => {
  it('reads the boundary a browser announced', () => {
    expect(boundaryOf(`multipart/form-data; boundary=${BOUNDARY}`)).toBe(
      BOUNDARY,
    );
  });

  it('reads a quoted one', () => {
    expect(boundaryOf(`multipart/form-data; boundary="${BOUNDARY}"`)).toBe(
      BOUNDARY,
    );
  });

  it('says nothing for a post that is not multipart', () => {
    expect(boundaryOf('application/x-www-form-urlencoded')).toBeNull();
    expect(boundaryOf('multipart/form-data')).toBeNull();
    expect(boundaryOf(undefined)).toBeNull();
  });
});

describe('parsing the parts', () => {
  it('reads an ordinary text field', () => {
    const parts = parseMultipart(
      body([
        'content-disposition: form-data; name="request"\r\n\r\nhello there',
      ]),
      BOUNDARY,
    );

    expect(parts).toEqual([
      { kind: 'field', name: 'request', value: 'hello there' },
    ]);
  });

  it('reads a file, with its name, type and bytes intact', () => {
    const parts = parseMultipart(
      body([
        'content-disposition: form-data; name="docs"; ' +
          'filename="notes.txt"\r\n' +
          'content-type: text/plain\r\n\r\nline one\r\nline two',
      ]),
      BOUNDARY,
    );
    const [part] = parts;

    expect(part?.kind).toBe('file');
    expect(part).toMatchObject({
      name: 'docs',
      filename: 'notes.txt',
      contentType: 'text/plain',
    });
    expect(
      part?.kind === 'file' ? Buffer.from(part.body).toString('utf8') : '',
    ).toBe('line one\r\nline two');
  });

  it('reads the field name when the filename is written first', () => {
    // The disposition's parameters have no
    // required order. Looking for `name=` anywhere
    // in the header finds the one inside
    // `filename=` first, which renames the field
    // to the file and drops the upload on the
    // floor — silently, because the part still
    // parses.
    const parts = parseMultipart(
      body([
        'content-disposition: form-data; filename="x.bin"; ' +
          'name="docs"\r\ncontent-type: text/plain\r\n\r\nbytes',
      ]),
      BOUNDARY,
    );

    expect(parts[0]).toMatchObject({
      kind: 'file',
      name: 'docs',
      filename: 'x.bin',
    });
  });

  it('reads several parts in the order they were sent', () => {
    const parts = parseMultipart(
      body([
        'content-disposition: form-data; name="a"\r\n\r\none',
        'content-disposition: form-data; name="b"\r\n\r\ntwo',
      ]),
      BOUNDARY,
    );

    expect(parts.map((part) => part.name)).toEqual(['a', 'b']);
  });

  it('passes bytes that are not text through untouched', () => {
    // The assertion above uses text, which would
    // survive a decode and re-encode. Most uploads
    // would not: a PDF or an image decoded as text
    // comes back full of replacement characters
    // and is silently corrupt.
    const raw = Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\ncontent-disposition: form-data; name="f"; ` +
          `filename="x.bin"\r\n\r\n`,
        'binary',
      ),
      Buffer.from([0x00, 0x80, 0xff, 0xfe, 0x41]),
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'binary'),
    ]);

    const [part] = parseMultipart(new Uint8Array(raw), BOUNDARY);

    expect(part?.kind === 'file' ? [...part.body] : []).toEqual([
      0x00, 0x80, 0xff, 0xfe, 0x41,
    ]);
  });

  it('takes a file part with no declared type as opaque bytes', () => {
    const parts = parseMultipart(
      body([
        'content-disposition: form-data; name="f"; filename="x.bin"\r\n\r\nz',
      ]),
      BOUNDARY,
    );

    expect(parts[0]).toMatchObject({
      contentType: 'application/octet-stream',
    });
  });

  it('keeps an empty file part, because the browser sends one', () => {
    // A file input nobody chose a file for still
    // posts a part, with an empty filename. It has
    // to be recognisable so it can be dropped
    // rather than stored as a zero-byte object.
    const parts = parseMultipart(
      body([
        'content-disposition: form-data; name="f"; filename=""\r\n' +
          'content-type: application/octet-stream\r\n\r\n',
      ]),
      BOUNDARY,
    );

    expect(parts[0]).toMatchObject({ kind: 'file', filename: '' });
  });

  it('ignores a part that names no field', () => {
    const parts = parseMultipart(
      body(['content-type: text/plain\r\n\r\norphan']),
      BOUNDARY,
    );

    expect(parts).toEqual([]);
  });

  it('stops at the closing boundary and ignores what follows', () => {
    const raw = Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\ncontent-disposition: form-data; name="a"\r\n` +
          `\r\none\r\n--${BOUNDARY}--\r\n`,
        'binary',
      ),
      Buffer.from('trailing rubbish', 'binary'),
    ]);

    expect(parseMultipart(new Uint8Array(raw), BOUNDARY)).toEqual([
      { kind: 'field', name: 'a', value: 'one' },
    ]);
  });

  it('finds nothing in a body that is not one', () => {
    expect(
      parseMultipart(new Uint8Array(Buffer.from('nonsense')), BOUNDARY),
    ).toEqual([]);
  });
});
