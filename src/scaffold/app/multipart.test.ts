import { describe, expect, it } from 'vitest';

import { readPosted } from './multipart.js';

/**
 * Reading a browser's posted form, in either
 * encoding one arrives in.
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
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;

/** The parts of a multipart body, as posted. */
function posted(parts: string[]) {
  return readPosted(body(parts), MULTIPART);
}

/** A body the way a browser writes one. */
function body(parts: string[]): Uint8Array {
  const text = parts
    .map((part) => `--${BOUNDARY}\r\n${part}\r\n`)
    .concat(`--${BOUNDARY}--\r\n`)
    .join('');

  return new Uint8Array(Buffer.from(text, 'binary'));
}

describe('which encoding arrived', () => {
  const one = ['content-disposition: form-data; name="a"\r\n\r\none'];

  it('reads a multipart body by the boundary it announced', () => {
    expect(readPosted(body(one), MULTIPART).fields).toEqual({ a: 'one' });
  });

  it('reads one whose boundary is quoted', () => {
    const quotedType = `multipart/form-data; boundary="${BOUNDARY}"`;

    expect(readPosted(body(one), quotedType).fields).toEqual({ a: 'one' });
  });

  /**
   * A form with no file posts an encoded string,
   * which carries fields and never a file. The
   * caller asks for a posted body either way.
   */
  it('reads an encoded string as fields', () => {
    const bytes = new Uint8Array(Buffer.from('a=one&b=two+three'));
    const result = readPosted(bytes, 'application/x-www-form-urlencoded');

    expect(result).toEqual({ fields: { a: 'one', b: 'two three' }, files: [] });
  });

  it('treats a body announcing no usable boundary as encoded', () => {
    const bytes = new Uint8Array(Buffer.from('a=one'));

    expect(readPosted(bytes, 'multipart/form-data').fields).toEqual({
      a: 'one',
    });
    expect(readPosted(bytes, undefined).fields).toEqual({ a: 'one' });
  });
});

describe('what a multipart body holds', () => {
  it('reads an ordinary text field', () => {
    const result = posted([
      'content-disposition: form-data; name="request"\r\n\r\nhello there',
    ]);

    expect(result).toEqual({ fields: { request: 'hello there' }, files: [] });
  });

  it('reads a file, with its name, type and bytes intact', () => {
    const [file] = posted([
      'content-disposition: form-data; name="docs"; ' +
        'filename="notes.txt"\r\n' +
        'content-type: text/plain\r\n\r\nline one\r\nline two',
    ]).files;

    expect(file).toMatchObject({
      name: 'docs',
      filename: 'notes.txt',
      contentType: 'text/plain',
    });
    expect(Buffer.from(file?.body ?? []).toString('utf8')).toBe(
      'line one\r\nline two',
    );
  });

  it('reads the field name when the filename is written first', () => {
    // The disposition's parameters have no
    // required order. Looking for `name=` anywhere
    // in the header finds the one inside
    // `filename=` first, which renames the field
    // to the file and drops the upload on the
    // floor — silently, because the part still
    // parses.
    const result = posted([
      'content-disposition: form-data; filename="x.bin"; ' +
        'name="docs"\r\ncontent-type: text/plain\r\n\r\nbytes',
    ]);

    expect(result.files[0]).toMatchObject({ name: 'docs', filename: 'x.bin' });
  });

  it('reads several parts in the order they were sent', () => {
    const result = posted([
      'content-disposition: form-data; name="a"\r\n\r\none',
      'content-disposition: form-data; name="b"\r\n\r\ntwo',
    ]);

    expect(Object.keys(result.fields)).toEqual(['a', 'b']);
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

    const [file] = readPosted(new Uint8Array(raw), MULTIPART).files;

    expect([...(file?.body ?? [])]).toEqual([0x00, 0x80, 0xff, 0xfe, 0x41]);
  });

  it('takes a file part with no declared type as opaque bytes', () => {
    const result = posted([
      'content-disposition: form-data; name="f"; filename="x.bin"\r\n\r\nz',
    ]);

    expect(result.files[0]).toMatchObject({
      contentType: 'application/octet-stream',
    });
  });

  it('keeps an empty file part, because the browser sends one', () => {
    // A file input nobody chose a file for still
    // posts a part, with an empty filename. It has
    // to be recognisable so it can be dropped
    // rather than stored as a zero-byte object.
    const result = posted([
      'content-disposition: form-data; name="f"; filename=""\r\n' +
        'content-type: application/octet-stream\r\n\r\n',
    ]);

    expect(result.files[0]).toMatchObject({ name: 'f', filename: '' });
  });

  it('ignores a part that names no field', () => {
    expect(posted(['content-type: text/plain\r\n\r\norphan'])).toEqual({
      fields: {},
      files: [],
    });
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

    expect(readPosted(new Uint8Array(raw), MULTIPART)).toEqual({
      fields: { a: 'one' },
      files: [],
    });
  });

  it('finds nothing in a body that is not one', () => {
    const bytes = new Uint8Array(Buffer.from('nonsense'));

    expect(readPosted(bytes, MULTIPART)).toEqual({ fields: {}, files: [] });
  });
});
