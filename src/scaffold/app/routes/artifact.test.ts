import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { withServer } from '../../../test-support/serve.js';
import type { ArtifactStore } from '../artifacts.js';
import { mintArtifactLink, mintFormLink } from '../links.js';
import { parseKeyRing } from '../signed-links.js';

import { artifactRoutes, type ArtifactDeps } from './artifact.js';

/**
 * `GET /a/:token` — reading a file a workflow
 * produced.
 *
 * The whole point of this route is what it does
 * *not* do: it never carries the bytes. It checks
 * the token, asks the store for a signed URL and
 * redirects. A route that proxied instead would
 * tie up the process that is also running
 * workflows for the length of every download, and
 * it is one line's difference, so the empty body
 * is asserted rather than intended.
 */

const RING = parseKeyRing(`k1:${'ab'.repeat(32)}`);
const NOW = 1_767_225_600_000;

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

const ARTIFACT_TOKEN = tokenOf(
  mintArtifactLink({
    ring: RING,
    baseUrl: 'https://app.example.com',
    key: 'runs/wf_1/draft.md',
    to: 'sam@hillsong.io',
    expiresInSeconds: 604800,
    now: NOW,
  }),
);

const FORM_TOKEN = tokenOf(
  mintFormLink({
    ring: RING,
    baseUrl: 'https://app.example.com',
    runId: 'wf_1',
    nodeId: 'await_form',
    to: 'sam@hillsong.io',
    expiresInSeconds: 604800,
    now: NOW,
  }),
);

function harness(store: ArtifactStore | null) {
  const presigned: string[] = [];
  const recording: ArtifactStore | null =
    store === null
      ? null
      : {
          put: store.put,
          async presign(key) {
            presigned.push(key);

            return store.presign(key);
          },
        };

  const deps: ArtifactDeps = { ring: RING, store: recording };
  const app = express();
  app.use(artifactRoutes(deps));

  return { app, presigned };
}

const STORE: ArtifactStore = {
  async put() {},
  async presign(key) {
    return `https://s3.example.com/bucket/${key}?X-Amz-Signature=abc`;
  },
};

async function get(
  app: express.Express,
  path: string,
): Promise<{ status: number; location: string | null; body: string }> {
  return withServer(app, async (base) => {
    const response = await fetch(`${base}${path}`, { redirect: 'manual' });

    return {
      status: response.status,
      location: response.headers.get('location'),
      body: await response.text(),
    };
  });
}

describe('a valid artifact link', () => {
  it('redirects to a URL the store signed', async () => {
    const { app, presigned } = harness(STORE);
    const response = await get(app, `/a/${ARTIFACT_TOKEN}`);

    expect(response.status).toBe(302);
    expect(response.location).toBe(
      'https://s3.example.com/bucket/runs/wf_1/draft.md?X-Amz-Signature=abc',
    );
    expect(presigned).toEqual(['runs/wf_1/draft.md']);
  });

  it('carries no body at all, so no byte of the file passes through', async () => {
    const { app } = harness(STORE);
    const response = await get(app, `/a/${ARTIFACT_TOKEN}`);

    expect(response.body).toBe('');
  });
});

describe('a link that does not verify', () => {
  it('is refused when it is not a token at all', async () => {
    const { app, presigned } = harness(STORE);
    const response = await get(app, '/a/not-a-token');

    expect(response.status).toBe(400);
    expect(response.body).toContain('malformed');
    expect(presigned).toEqual([]);
  });

  it('is refused when it is a form token, not an artifact one', async () => {
    const { app, presigned } = harness(STORE);
    const response = await get(app, `/a/${FORM_TOKEN}`);

    expect(response.status).toBe(400);
    expect(response.body).toContain('wrong-type');
    expect(presigned).toEqual([]);
  });
});

describe('an app with no object store configured', () => {
  it('says the service is not there, rather than pretending', async () => {
    const { app } = harness(null);
    const response = await get(app, `/a/${ARTIFACT_TOKEN}`);

    expect(response.status).toBe(503);
  });

  it('still refuses an invalid link, and says so the same way', async () => {
    // The token is checked before the store is
    // consulted, so a bad link is a bad link
    // whether or not the app could have served it.
    const { app } = harness(null);
    const response = await get(app, '/a/not-a-token');

    expect(response.status).toBe(400);
  });
});
