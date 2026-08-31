import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { expectGolden } from '../../test-support/fixtures.js';
import {
  presignedGetUrl,
  s3Path,
  signedPutHeaders,
  type SigV4Credentials,
} from './sigv4.js';

/**
 * The credentials AWS publishes with its own
 * worked examples. They are documentation, not a
 * secret, and using them is the only way to
 * compare against a signature someone else
 * computed.
 */
const AWS_EXAMPLE: SigV4Credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};

const AWS_EXAMPLE_TIME = new Date('2013-05-24T00:00:00Z');

/**
 * Reads `Signature=` out of an Authorization
 * header.
 */
function signatureOf(authorization: string): string {
  return authorization.split('Signature=')[1] ?? '';
}

/**
 * The signer's only real proof. A self-consistent
 * golden catches a regression but would happily
 * freeze a wrong signature forever, so the first
 * assertions reproduce two signatures Amazon
 * published with the inputs that produce them.
 */
describe('against the signatures AWS publishes', () => {
  it('reproduces the presigned GET for examplebucket/test.txt', () => {
    const url = presignedGetUrl({
      origin: 'https://examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      credentials: AWS_EXAMPLE,
      expiresInSeconds: 86400,
      now: AWS_EXAMPLE_TIME,
    });

    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2F' +
        'us-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z' +
        '&X-Amz-Expires=86400' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835' +
        'f995330da4c265957d157751f604d404',
    );
  });

  it('reproduces the header-signed PUT for test$file.text', () => {
    const body = Buffer.from('Welcome to Amazon S3.', 'utf8');

    // The payload hash AWS prints beside the
    // example, asserted here so a wrong body
    // cannot masquerade as a wrong signer.
    expect(createHash('sha256').update(body).digest('hex')).toBe(
      '44ce7dd67c959e0d3524ffac1771dfbba' + '87d2b6b4b4e99e42034a8b803f8b072',
    );

    const headers = signedPutHeaders({
      origin: 'https://examplebucket.s3.amazonaws.com',
      path: '/test%24file.text',
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      body,
      credentials: AWS_EXAMPLE,
      now: AWS_EXAMPLE_TIME,
    });

    expect(headers['authorization']).toContain(
      'SignedHeaders=date;host;x-amz-content-sha256;' +
        'x-amz-date;x-amz-storage-class',
    );
    expect(signatureOf(headers['authorization'] ?? '')).toBe(
      '98ad721746da40c64f1a55b78f14c238' + 'd841ea1380cd77a1b5971af0ece108bd',
    );
  });
});

describe('s3Path', () => {
  it('addresses path-style and keeps key separators', () => {
    expect(s3Path('mboss-artifacts', 'runs/2f9c/receipt.pdf')).toBe(
      '/mboss-artifacts/runs/2f9c/receipt.pdf',
    );
  });

  it('percent-encodes the characters encodeURIComponent leaves alone', () => {
    expect(s3Path('b', "receipt (1)!'*.pdf")).toBe(
      '/b/receipt%20%281%29%21%27%2A.pdf',
    );
  });
});

describe('the signed request itself', () => {
  const target = {
    origin: 'http://minio.example:9000',
    path: s3Path('mboss-artifacts', 'runs/2f9c/receipt (1).pdf'),
    credentials: AWS_EXAMPLE,
    now: AWS_EXAMPLE_TIME,
  };

  it('signs the host with its port, which a custom endpoint has', () => {
    const headers = signedPutHeaders({
      ...target,
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('mBoss artifact bytes\n', 'utf8'),
    });

    // The proof the port is in the signature and
    // not merely in the URL: signing the same
    // request against a portless host has to give
    // a different answer.
    const portless = signedPutHeaders({
      ...target,
      origin: 'http://minio.example',
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('mBoss artifact bytes\n', 'utf8'),
    });

    expect(signatureOf(headers['authorization'] ?? '')).not.toBe(
      signatureOf(portless['authorization'] ?? ''),
    );
  });

  it('lowercases and trims the caller-supplied headers before signing', () => {
    const body = Buffer.from('mBoss artifact bytes\n', 'utf8');

    const shouted = signedPutHeaders({
      ...target,
      headers: { 'Content-Type': '  application/pdf  ' },
      body,
    });
    const plain = signedPutHeaders({
      ...target,
      headers: { 'content-type': 'application/pdf' },
      body,
    });

    expect(Object.keys(shouted)).toContain('content-type');
    expect(shouted['content-type']).toBe('application/pdf');
    expect(shouted['authorization']).toBe(plain['authorization']);
  });

  it('orders the presigned query parameters by name, as the spec asks', () => {
    const url = presignedGetUrl({ ...target, expiresInSeconds: 604800 });
    const names = [...new URL(url).searchParams.keys()].filter(
      (name) => name !== 'X-Amz-Signature',
    );

    expect(names).toEqual([...names].sort());
  });

  it('never returns a host header, which the HTTP client sets itself', () => {
    const headers = signedPutHeaders({
      ...target,
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('mBoss artifact bytes\n', 'utf8'),
    });

    expect(Object.keys(headers)).not.toContain('host');
  });

  it('reads the clock only from `now`, so two calls agree', () => {
    const first = presignedGetUrl({ ...target, expiresInSeconds: 604800 });
    const second = presignedGetUrl({ ...target, expiresInSeconds: 604800 });

    expect(first).toBe(second);
  });
});

/**
 * The frozen pair the spike exists to produce.
 * Both are read after the spec assertions above
 * pass, so what they lock is the remainder — the
 * parameter order, the header set and the exact
 * encoding of a key with a space in it.
 */
describe('frozen signatures', () => {
  const target = {
    origin: 'http://minio.example:9000',
    path: s3Path('mboss-artifacts', 'runs/2f9c/receipt (1).pdf'),
    credentials: AWS_EXAMPLE,
    now: AWS_EXAMPLE_TIME,
  };

  it('freezes a presigned GET', () => {
    const url = presignedGetUrl({ ...target, expiresInSeconds: 604800 });

    expectGolden('golden/scaffold/sigv4-get.txt', `${url}\n`);
  });

  it('freezes a signed PUT', () => {
    const headers = signedPutHeaders({
      ...target,
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('mBoss artifact bytes\n', 'utf8'),
    });

    const lines = Object.entries(headers)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, value]) => `${name}: ${value}\n`)
      .join('');

    expectGolden('golden/scaffold/sigv4-put.txt', lines);
  });
});
