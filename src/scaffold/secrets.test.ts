import { describe, expect, it } from 'vitest';

import { parseKeyRing } from '../signed-links/index.js';

import { mintEventsSecret, mintLinkKeys } from './secrets.js';

/**
 * The two secrets a project is born with.
 *
 * Both are minted once, written into `.env`, and
 * never regenerated: a second minting would
 * invalidate every outstanding form link and
 * every webhook the sender has already been
 * configured with.
 */

describe('mintLinkKeys', () => {
  it('mints a ring the link module accepts', () => {
    const ring = parseKeyRing(mintLinkKeys());

    expect(ring.active.kid).toBe('k1');
    expect(ring.active.key).toHaveLength(32);
  });

  it('mints a different ring every time', () => {
    expect(mintLinkKeys()).not.toBe(mintLinkKeys());
  });
});

describe('mintEventsSecret', () => {
  it('mints 32 bytes of hex', () => {
    expect(mintEventsSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mints a different secret every time', () => {
    expect(mintEventsSecret()).not.toBe(mintEventsSecret());
  });
});
