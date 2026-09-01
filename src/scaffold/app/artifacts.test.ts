import { describe, expect, it } from 'vitest';

import {
  artifactStoreFromEnv,
  createS3ArtifactStore,
  type S3Config,
} from './artifacts.js';
import { readEnv } from './env.js';

/**
 * The object store behind file uploads and
 * artifact links.
 *
 * The signing itself is tested next door against
 * the worked examples Amazon publishes; what is
 * checked here is the two requests this app makes
 * of it, and that an app with no store configured
 * says so rather than half-working.
 */

const CONFIG: S3Config = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'artifacts',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

const AT = new Date('2026-05-24T00:00:00Z');

type Call = { url: string; init: RequestInit };

function recording(status: number) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });

    return { status, ok: status < 300, text: async () => '' } as Response;
  }) as unknown as typeof globalThis.fetch;

  return { calls, fetchImpl };
}

describe('presigning a read', () => {
  const store = createS3ArtifactStore(CONFIG, undefined, () => AT);

  it('addresses the object path-style under the configured endpoint', async () => {
    const url = await store.presign('runs/wf_1/draft.md');

    expect(url.startsWith('https://s3.example.com/artifacts/runs/wf_1/')).toBe(
      true,
    );
  });

  it('signs it, so whoever follows it needs no credentials', async () => {
    const url = await store.presign('runs/wf_1/draft.md');

    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-SignedHeaders=host');
  });

  it('gives it a life measured in minutes, not days', async () => {
    // The link a person holds is the app's own
    // signed link; this one is handed to their
    // browser and followed at once, so a long
    // window would only widen what a leaked
    // redirect is worth.
    const url = await store.presign('runs/wf_1/draft.md');

    expect(url).toContain('X-Amz-Expires=300');
  });

  it('opens no connection of its own', async () => {
    const { calls, fetchImpl } = recording(200);
    const offline = createS3ArtifactStore(CONFIG, fetchImpl, () => AT);
    await offline.presign('runs/wf_1/draft.md');

    expect(calls).toEqual([]);
  });
});

describe('putting an object', () => {
  it('sends the bytes to the object it named', async () => {
    const { calls, fetchImpl } = recording(200);
    const store = createS3ArtifactStore(CONFIG, fetchImpl, () => AT);

    await store.put({
      key: 'runs/wf_1/notes.txt',
      body: new TextEncoder().encode('hello'),
      contentType: 'text/plain',
    });

    expect(calls[0]?.url).toBe(
      'https://s3.example.com/artifacts/runs/wf_1/notes.txt',
    );
    expect(calls[0]?.init.method).toBe('PUT');
  });

  it('signs the request in headers, with the payload hash', async () => {
    const { calls, fetchImpl } = recording(200);
    const store = createS3ArtifactStore(CONFIG, fetchImpl, () => AT);

    await store.put({
      key: 'k',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/octet-stream',
    });

    const headers = calls[0]?.init.headers as Record<string, string>;

    expect(headers.authorization).toContain('AWS4-HMAC-SHA256 Credential=');
    expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['content-type']).toBe('application/octet-stream');
  });

  it('throws when the store refused, rather than reporting success', async () => {
    const { fetchImpl } = recording(403);
    const store = createS3ArtifactStore(CONFIG, fetchImpl, () => AT);

    await expect(
      store.put({
        key: 'k',
        body: new Uint8Array([1]),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('403');
  });
});

/**
 * All five variables or none. A store configured
 * halfway is the one case that fails at the moment
 * somebody uploads a file rather than at boot.
 */
describe('reading the store out of the environment', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    DBOS_SYSTEM_DATABASE_URL: 'postgres://x',
    APP_BASE_URL: 'http://localhost:3000',
    APP_NAME: 'my_app',
    LINK_KEYS: `k1:${'ab'.repeat(32)}`,
    EVENTS_SECRET: 's',
    MAIL_FROM: 'a@b.c',
    TWILIO_API_KEY: 'SK',
    TWILIO_API_SECRET: 'secret',
  };

  const s3 = {
    S3_ENDPOINT: 'https://s3.example.com',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'artifacts',
    S3_ACCESS_KEY_ID: 'AKIA',
    S3_SECRET_ACCESS_KEY: 'shh',
  };

  it('builds a store when all five are set', () => {
    expect(artifactStoreFromEnv(readEnv({ ...base, ...s3 }))).not.toBeNull();
  });

  it('says there is none when they are absent', () => {
    expect(artifactStoreFromEnv(readEnv(base))).toBeNull();
  });

  it.each(Object.keys(s3))('says there is none without %s', (missing) => {
    const partial: Record<string, string> = { ...base, ...s3 };
    delete partial[missing];

    expect(artifactStoreFromEnv(readEnv(partial))).toBeNull();
  });
});
