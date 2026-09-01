// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for S3, over node:crypto
 * and nothing else.
 *
 * Hand-rolled rather than taken from a vendor SDK
 * for the same reason the mailer is: the store is
 * addressed by a plain endpoint, so a MinIO in
 * this project's own compose file and a real S3
 * bucket go through the identical code path, and
 * the whole signer is small enough to read in one
 * sitting.
 *
 * The two signatures it produces are pinned in
 * mBoss's own tests against the worked examples
 * Amazon publishes, so this is checked against
 * someone else's arithmetic rather than only
 * against itself.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';

/**
 * The only service this signs for. A parameter
 * would suggest the module is general, and the
 * scope of the whole file is one object store.
 */
const SERVICE = 's3';

/**
 * What a presigned GET puts where the payload hash
 * goes. The bytes are not known when the link is
 * minted and whoever follows it sends none.
 */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export type SigV4Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export type PresignedGetInput = {
  /** Scheme, host and port — no path. */
  origin: string;
  /** The request path, already encoded; s3Path
   *  builds one. */
  path: string;
  credentials: SigV4Credentials;
  expiresInSeconds: number;
  /** Passed in rather than read here, so a
   *  signature is a pure function of its inputs
   *  and can be frozen in a test. */
  now: Date;
};

export type SignedPutInput = {
  origin: string;
  path: string;
  /** Headers the caller wants signed and sent,
   *  such as content-type. */
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  credentials: SigV4Credentials;
  now: Date;
};

/**
 * Percent-encodes one path or query component the
 * way the signing spec asks.
 *
 * encodeURIComponent is nearly right and leaves
 * six characters alone that S3 expects encoded, so
 * a key containing a bracket or an apostrophe
 * would otherwise sign one string and fetch
 * another.
 */
function encodeComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The request path for an object, addressed
 * path-style: /bucket/key.
 *
 * Path-style rather than virtual-host style
 * because a self-hosted store has one hostname and
 * no per-bucket DNS, and S3 accepts both. Slashes
 * inside a key stay separators, which is what
 * makes a key read like a directory in a console.
 */
export function s3Path(bucket: string, key: string): string {
  const encodedKey = key.split('/').map(encodeComponent).join('/');
  return `/${encodeComponent(bucket)}/${encodedKey}`;
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** `20130524T000000Z` — the form the spec wants. */
function amzDateOf(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * The signing key, derived once per date, region
 * and service. Deriving it from the date is what
 * limits the blast radius of a leaked signature to
 * a single day.
 */
function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function credentialScope(dateStamp: string, region: string): string {
  return `${dateStamp}/${region}/${SERVICE}/aws4_request`;
}

/**
 * Signs one canonical request. Every caller builds
 * the canonical request differently — a presigned
 * GET puts its parameters in the query, a PUT puts
 * them in headers — but from here on the two are
 * the same arithmetic.
 */
function sign(
  canonicalRequest: string,
  credentials: SigV4Credentials,
  amzDate: string,
): string {
  const dateStamp = amzDate.slice(0, 8);
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope(dateStamp, credentials.region),
    sha256Hex(canonicalRequest),
  ].join('\n');

  const key = signingKey(
    credentials.secretAccessKey,
    dateStamp,
    credentials.region,
  );
  return hmac(key, stringToSign).toString('hex');
}

/**
 * `name=value&…`.
 *
 * The spec wants the parameters ordered by name,
 * and the one caller below writes them that way
 * already. Sorting here too would be a line no
 * test could ever reach, so the ordering is
 * asserted on the finished URL instead, where a
 * parameter added out of order in a later version
 * actually fails.
 */
function canonicalQuery(params: readonly [string, string][]): string {
  return params
    .map(
      ([name, value]) => `${encodeComponent(name)}=${encodeComponent(value)}`,
    )
    .join('&');
}

/**
 * A signed link to an object, good for
 * `expiresInSeconds`.
 *
 * Only `host` is signed, so whoever follows the
 * link needs no headers at all — which is what
 * lets the artifact route answer with a redirect
 * and never carry the bytes itself.
 */
export function presignedGetUrl(input: PresignedGetInput): string {
  const { origin, path, credentials, expiresInSeconds, now } = input;
  const amzDate = amzDateOf(now);
  const host = new URL(origin).host;

  const query = canonicalQuery([
    ['X-Amz-Algorithm', ALGORITHM],
    [
      'X-Amz-Credential',
      `${credentials.accessKeyId}/` +
        credentialScope(amzDate.slice(0, 8), credentials.region),
    ],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);

  const canonicalRequest = [
    'GET',
    path,
    query,
    `host:${host}`,
    '',
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const signature = sign(canonicalRequest, credentials, amzDate);
  return `${origin}${path}?${query}&X-Amz-Signature=${signature}`;
}

/**
 * The headers a PUT of `body` must carry.
 *
 * `host` is signed but is not in the result: the
 * HTTP client sets it from the URL, and a client
 * that is handed one in a header map either
 * ignores it or refuses it.
 */
export function signedPutHeaders(
  input: SignedPutInput,
): Record<string, string> {
  const { origin, path, headers, body, credentials, now } = input;
  const amzDate = amzDateOf(now);
  const payloadHash = sha256Hex(body);

  const sent: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    sent[name.toLowerCase()] = value.trim();
  }
  sent['x-amz-content-sha256'] = payloadHash;
  sent['x-amz-date'] = amzDate;

  const host: [string, string] = ['host', new URL(origin).host];
  const signed = [...Object.entries(sent), host].sort(([a], [b]) =>
    a < b ? -1 : 1,
  );

  const names = signed.map(([name]) => name);
  const canonicalHeaders = signed
    .map(([name, value]) => `${name}:${value}\n`)
    .join('');

  const canonicalRequest = [
    'PUT',
    path,
    '',
    canonicalHeaders,
    names.join(';'),
    payloadHash,
  ].join('\n');

  const signature = sign(canonicalRequest, credentials, amzDate);
  const scope = credentialScope(amzDate.slice(0, 8), credentials.region);

  return {
    ...sent,
    authorization:
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}
