// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import type { Env } from './env.js';
import { presignedGetUrl, s3Path, signedPutHeaders } from './sigv4.js';

/**
 * Where a file a workflow produced, or a file
 * somebody uploaded through a form, actually
 * lives.
 *
 * Two operations, because two is all this app
 * does: put an object, and hand out a link to read
 * one. The link is signed by the store rather than
 * served by this app, which is what keeps a
 * download off the process that is also running
 * workflows.
 *
 * The whole thing is optional. With no object
 * store configured the artifact route answers that
 * it has none and a form renders its dropzone
 * disabled, which is a better answer than a form
 * that quietly loses a file.
 */
export type ArtifactStore = {
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void>;
  presign(key: string): Promise<string>;
};

export type S3Config = {
  /** Scheme, host and port. A self-hosted store
   *  and a real bucket differ only here. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * How long a presigned read lasts.
 *
 * The link a person holds is this app's own signed
 * link, which lasts days; this one is handed
 * straight to their browser as a redirect and
 * followed immediately, so a longer window would
 * only widen what a leaked redirect is worth.
 */
const PRESIGN_SECONDS = 300;

export function createS3ArtifactStore(
  config: S3Config,
  fetchImpl?: typeof globalThis.fetch,
  now: () => Date = () => new Date(),
): ArtifactStore {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const credentials = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
  };

  return {
    async presign(key: string): Promise<string> {
      // Signing is arithmetic over the key and the
      // clock; nothing is asked of the store, so
      // this opens no connection at all.
      return presignedGetUrl({
        origin: config.endpoint,
        path: s3Path(config.bucket, key),
        credentials,
        expiresInSeconds: PRESIGN_SECONDS,
        now: now(),
      });
    },

    async put(input): Promise<void> {
      const path = s3Path(config.bucket, input.key);
      const headers = signedPutHeaders({
        origin: config.endpoint,
        path,
        headers: { 'content-type': input.contentType },
        body: input.body,
        credentials,
        now: now(),
      });

      const response = await doFetch(`${config.endpoint}${path}`, {
        method: 'PUT',
        headers,
        body: input.body,
      });

      if (response.status >= 300) {
        throw new Error(
          `object store refused the upload: HTTP ${response.status}`,
        );
      }
    },
  };
}

/**
 * The store this app is configured for, or null.
 *
 * All five variables or none: a store configured
 * halfway would fail at the moment somebody
 * uploaded a file rather than at boot, which is
 * the worst of both.
 */
export function artifactStoreFromEnv(env: Env): ArtifactStore | null {
  const {
    S3_ENDPOINT,
    S3_REGION,
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
  } = env;

  if (
    S3_ENDPOINT === undefined ||
    S3_REGION === undefined ||
    S3_BUCKET === undefined ||
    S3_ACCESS_KEY_ID === undefined ||
    S3_SECRET_ACCESS_KEY === undefined
  ) {
    return null;
  }

  return createS3ArtifactStore({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  });
}
