import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  FORM_LINK_MAX_SECONDS,
  artifactUrl,
  formUrl,
  mintArtifactLink,
  mintFormLink,
} from './links.js';
import { parseKeyRing, verifyLink } from './signed-links.js';

/**
 * The two links this app puts in an email.
 *
 * Both are minted from the clock, so the clock is
 * a parameter: a workflow step that replayed would
 * otherwise produce a different token every time
 * and none of this could be pinned.
 */

const RING = parseKeyRing(`k1:${'ab'.repeat(32)}`);
const BASE = 'https://app.example.com';

/** A fixed instant, and deliberately not a whole
 *  second: the claims have to be integers. */
const NOW = 1_767_225_600_123;
const NOW_SECONDS = 1_767_225_600;

// `verifyLink` reads the real clock to check an
// expiry, so the tests below hold it at the same
// instant the tokens were minted at. Without this
// every one of these tokens is already expired by
// the time the assertion runs.
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

describe('a form link', () => {
  const url = mintFormLink({
    ring: RING,
    baseUrl: BASE,
    runId: 'wf_81c2',
    nodeId: 'await_form',
    to: 'sam@hillsong.io',
    expiresInSeconds: 604800,
    now: NOW,
  });

  it('is the form route with the token in the path', () => {
    expect(url.startsWith(`${BASE}/f/`)).toBe(true);
    expect(url).toBe(formUrl(BASE, tokenOf(url)));
  });

  it('verifies as a form token for that run and node', () => {
    const result = verifyLink(RING, tokenOf(url), 'app.form');

    expect(result.ok).toBe(true);
    expect(result.ok && result.payload).toMatchObject({
      t: 'app.form',
      run: 'wf_81c2',
      node: 'await_form',
      sub: 'sam@hillsong.io',
    });
  });

  it('stamps whole seconds, which is all the format accepts', () => {
    const result = verifyLink(RING, tokenOf(url), 'app.form');
    const payload = result.ok ? result.payload : null;

    expect(payload?.iat).toBe(NOW_SECONDS);
  });

  it('expires when the wait it opens does', () => {
    const result = verifyLink(RING, tokenOf(url), 'app.form');
    const payload =
      result.ok && 'exp' in result.payload ? result.payload : null;

    expect(payload?.exp).toBe(NOW_SECONDS + 604800);
  });

  it('never outlives a month, however long the wait is', () => {
    // A wait can be configured for a year. A link
    // that lived that long is a credential sitting
    // in an inbox with nothing to revoke it.
    const long = mintFormLink({
      ring: RING,
      baseUrl: BASE,
      runId: 'wf_81c2',
      nodeId: 'await_form',
      to: 'sam@hillsong.io',
      expiresInSeconds: 400 * 86400,
      now: NOW,
    });
    const result = verifyLink(RING, tokenOf(long), 'app.form');
    const payload =
      result.ok && 'exp' in result.payload ? result.payload : null;

    expect(payload?.exp).toBe(NOW_SECONDS + FORM_LINK_MAX_SECONDS);
    expect(FORM_LINK_MAX_SECONDS).toBe(30 * 86400);
  });
});

describe('an artifact link', () => {
  const url = mintArtifactLink({
    ring: RING,
    baseUrl: BASE,
    key: 'runs/wf_81c2/draft.md',
    to: 'sam@hillsong.io',
    expiresInSeconds: 604800,
    now: NOW,
  });

  it('is the artifact route with the token in the path', () => {
    expect(url.startsWith(`${BASE}/a/`)).toBe(true);
    expect(url).toBe(artifactUrl(BASE, tokenOf(url)));
  });

  it('carries the storage key it unlocks and nothing more', () => {
    const result = verifyLink(RING, tokenOf(url), 'app.artifact');

    expect(result.ok).toBe(true);
    expect(result.ok && result.payload).toMatchObject({
      t: 'app.artifact',
      art: 'runs/wf_81c2/draft.md',
      sub: 'sam@hillsong.io',
    });
  });

  it('expires seven days out when that is what it was given', () => {
    const result = verifyLink(RING, tokenOf(url), 'app.artifact');
    const payload =
      result.ok && 'exp' in result.payload ? result.payload : null;

    expect(payload?.exp).toBe(NOW_SECONDS + 604800);
  });

  it('is not accepted at the form route', () => {
    expect(verifyLink(RING, tokenOf(url), 'app.form')).toEqual({
      ok: false,
      reason: 'wrong-type',
    });
  });
});
