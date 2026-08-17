import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintLink, parseKeyRing, verifyLink } from './index.js';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('parseKeyRing', () => {
  it('parses a single entry into an active key and a one-entry ring', () => {
    const ring = parseKeyRing(`k1:${KEY_A}`);
    expect(ring.active.kid).toBe('k1');
    expect(ring.active.key).toEqual(Buffer.from(KEY_A, 'hex'));
    expect(ring.active.key).toHaveLength(32);
    expect(ring.all.size).toBe(1);
  });

  it('signs with the first entry and keeps every entry for verification, in order', () => {
    const ring = parseKeyRing(`k1:${KEY_A},k0:${KEY_B}`);
    expect(ring.active.kid).toBe('k1');
    expect([...ring.all.keys()]).toEqual(['k1', 'k0']);
    expect(ring.all.get('k0')).toEqual(Buffer.from(KEY_B, 'hex'));
  });

  it('tolerates surrounding whitespace and a trailing comma', () => {
    const ring = parseKeyRing(`  k1 : ${KEY_A} , k0:${KEY_B} ,  `);
    expect(ring.active.kid).toBe('k1');
    expect([...ring.all.keys()]).toEqual(['k1', 'k0']);
  });

  it.each([
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['an entry with no colon', 'k1'],
    ['an entry with no key', 'k1:'],
    ['an entry with no kid', `:${KEY_A}`],
    ['a non-hex key', 'k1:xyz'],
    ['a key one nibble short', `k1:${'a'.repeat(63)}`],
    ['a key one nibble long', `k1:${'a'.repeat(65)}`],
    ['a kid with punctuation', `k1:$$`],
    ['a duplicate kid', `k1:${KEY_A},k1:${KEY_B}`],
    ['a kid with a space in it', `bad kid:${KEY_A}`],
  ])('throws on %s', (_why, env) => {
    expect(() => parseKeyRing(env)).toThrow();
  });

  it('never puts key material in the error message', () => {
    expect(() => parseKeyRing(`k1:${KEY_A},k1:${KEY_B}`)).toThrow(
      expect.not.stringContaining(KEY_A),
    );
  });
});

describe('mint and verify round trip', () => {
  const ring = parseKeyRing(`k1:${KEY_A}`);
  const IAT = 1_755_212_345;
  const EXP = IAT + 3600;

  // The fixtures use fixed timestamps, so the clock is pinned to them; otherwise the real clock
  // runs past `exp` and these tokens verify as expired rather than as round trips.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(IAT * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('carries a manage token through unchanged', () => {
    const token = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT });
    const result = verifyLink(ring, token, 'wl.manage');
    expect(result).toEqual({
      ok: true,
      payload: { v: 1, t: 'wl.manage', kid: 'k1', sub: 'ckv1', tv: 1, iat: IAT },
    });
  });

  it('carries a form token through unchanged', () => {
    const claims = {
      t: 'app.form',
      run: 'run1',
      node: 'node1',
      sub: 'ckv1',
      iat: IAT,
      exp: EXP,
    } as const;
    const result = verifyLink(ring, mintLink(ring, claims), 'app.form');
    expect(result).toEqual({ ok: true, payload: { v: 1, kid: 'k1', ...claims } });
  });

  it('carries an artifact token through unchanged', () => {
    const claims = { t: 'app.artifact', art: 'art1', sub: 'ckv1', iat: IAT, exp: EXP } as const;
    const result = verifyLink(ring, mintLink(ring, claims), 'app.artifact');
    expect(result).toEqual({ ok: true, payload: { v: 1, kid: 'k1', ...claims } });
  });

  it('mints two base64url halves separated by a single dot, the second 32 bytes', () => {
    const token = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.split('.')).toHaveLength(2);
    expect(Buffer.from(token.split('.')[1]!, 'base64url')).toHaveLength(32);
  });

  it('mints the same string regardless of the order the claims were written in', () => {
    const a = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT });
    const b = mintLink(ring, { iat: IAT, tv: 1, sub: 'ckv1', t: 'wl.manage' });
    expect(a).toBe(b);
  });

  it('starts the payload with the version claim', () => {
    const token = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT });
    expect(token.startsWith('eyJ2Ijox')).toBe(true);
    expect(Buffer.from('eyJ2Ijox', 'base64url').toString()).toBe('{"v":1');
  });
});

describe('rejecting tampered and mismatched tokens', () => {
  const ring = parseKeyRing(`k1:${KEY_A}`);
  const IAT = 1_755_212_345;
  const manage = { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT } as const;

  // Pinned so that the form and artifact fixtures below are unexpired, isolating the reason under
  // test: expiry is checked before type, so a stale clock would report 'expired' instead.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(IAT * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a token whose signature has been altered', () => {
    const token = mintLink(ring, manage);
    const [payload, sig] = token.split('.') as [string, string];
    const flipped = sig[0] === 'A' ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(verifyLink(ring, `${payload}.${flipped}`, 'wl.manage')).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects a payload swapped onto another token signature', () => {
    const one = mintLink(ring, { ...manage, tv: 1 });
    const two = mintLink(ring, { ...manage, tv: 2 });
    const forged = `${two.split('.')[0]}.${one.split('.')[1]}`;
    expect(verifyLink(ring, forged, 'wl.manage')).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects a token signed with a different secret under the same kid', () => {
    const other = parseKeyRing(`k1:${KEY_B}`);
    expect(verifyLink(ring, mintLink(other, manage), 'wl.manage')).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects a kid the ring does not hold — it cannot be authenticated', () => {
    const other = parseKeyRing(`k9:${KEY_B}`);
    expect(verifyLink(ring, mintLink(other, manage), 'wl.manage')).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it.each([
    ['wl.manage', { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT }],
    ['app.form', { t: 'app.form', run: 'r', node: 'n', sub: 'ckv1', iat: IAT, exp: IAT + 60 }],
    ['app.artifact', { t: 'app.artifact', art: 'a', sub: 'ckv1', iat: IAT, exp: IAT + 60 }],
  ] as const)('rejects a %s token asked for as either other type', (type, claims) => {
    const token = mintLink(ring, claims);
    const others = (['wl.manage', 'app.form', 'app.artifact'] as const).filter((t) => t !== type);
    for (const other of others) {
      expect(verifyLink(ring, token, other)).toEqual({ ok: false, reason: 'wrong-type' });
    }
  });
});

describe('the token version claim', () => {
  const ring = parseKeyRing(`k1:${KEY_A}`);
  const IAT = 1_755_212_345;

  it('carries the version faithfully so the caller can compare it against the subscriber', () => {
    const first = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT });
    const seventh = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 7, iat: IAT });
    expect(first).not.toBe(seventh);

    const a = verifyLink(ring, first, 'wl.manage');
    const b = verifyLink(ring, seventh, 'wl.manage');
    expect(a.ok && a.payload.t === 'wl.manage' && a.payload.tv).toBe(1);
    expect(b.ok && b.payload.t === 'wl.manage' && b.payload.tv).toBe(7);
  });

  it('does not judge the version itself — there is no reason for a stale one', () => {
    const result = verifyLink(
      ring,
      mintLink(ring, { t: 'wl.manage', sub: 's', tv: 1, iat: IAT }),
      'app.form',
    );
    if (!result.ok) {
      // @ts-expect-error the reason union has no 'wrong-tv': comparing against the stored version
      // is the caller's job, since this module has no idea what that version currently is.
      const reason: 'wrong-tv' = result.reason;
      void reason;
    }
  });
});

describe('expiry', () => {
  const ring = parseKeyRing(`k1:${KEY_A}`);
  const IAT = 1_755_212_345;
  const EXP = IAT + 3600;

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Moves the clock to `at` (epoch seconds) and verifies the given token. */
  function verifyAt(token: string, at: number, type: 'app.form' | 'app.artifact') {
    vi.useFakeTimers();
    vi.setSystemTime(at * 1000);
    return verifyLink(ring, token, type);
  }

  it.each([
    ['app.form', { t: 'app.form', run: 'r', node: 'n', sub: 'ckv1', iat: IAT, exp: EXP }],
    ['app.artifact', { t: 'app.artifact', art: 'a', sub: 'ckv1', iat: IAT, exp: EXP }],
  ] as const)('accepts a %s token up to and including its exp second', (type, claims) => {
    vi.useFakeTimers();
    vi.setSystemTime(IAT * 1000);
    const token = mintLink(ring, claims);

    expect(verifyAt(token, EXP - 1, type).ok).toBe(true);
    expect(verifyAt(token, EXP, type).ok).toBe(true);
    expect(verifyAt(token, EXP + 1, type)).toEqual({ ok: false, reason: 'expired' });
  });

  it('never expires a manage token, which carries no exp at all', () => {
    vi.useFakeTimers();
    vi.setSystemTime(IAT * 1000);
    const token = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT });

    vi.setSystemTime((IAT + 10 * 365 * 24 * 3600) * 1000);
    expect(verifyLink(ring, token, 'wl.manage').ok).toBe(true);
  });
});

describe('malformed tokens', () => {
  const ring = parseKeyRing(`k1:${KEY_A}`);
  const IAT = 1_755_212_345;

  /** Re-encodes an arbitrary claim object as the payload half, with a valid-length dummy signature. */
  function payloadToken(claims: unknown): string {
    const bytes = Buffer.from(JSON.stringify(claims), 'utf8');
    return `${bytes.toString('base64url')}.${Buffer.alloc(32).toString('base64url')}`;
  }

  const cases: [string, string][] = [
    ['an empty string', ''],
    ['no separator at all', 'garbage'],
    ['two separators', 'a.b.c'],
    ['an empty payload half', '.abc'],
    ['an empty signature half', 'abc.'],
    ['characters outside the base64url alphabet', '!!!.!!!'],
    [
      'a payload that is not JSON',
      `${Buffer.from('not json').toString('base64url')}.${Buffer.alloc(32).toString('base64url')}`,
    ],
    ['a payload that is a JSON array', payloadToken([1, 2, 3])],
    ['a payload that is JSON null', payloadToken(null)],
    [
      'an unknown format version',
      payloadToken({ v: 2, t: 'wl.manage', kid: 'k1', sub: 's', tv: 1, iat: IAT }),
    ],
    ['an unknown link type', payloadToken({ v: 1, t: 'nope', kid: 'k1', sub: 's', iat: IAT })],
    [
      'a manage payload with no tv',
      payloadToken({ v: 1, t: 'wl.manage', kid: 'k1', sub: 's', iat: IAT }),
    ],
    [
      'a tv that is a string',
      payloadToken({ v: 1, t: 'wl.manage', kid: 'k1', sub: 's', tv: '1', iat: IAT }),
    ],
    [
      'an iat that is not an integer',
      payloadToken({ v: 1, t: 'wl.manage', kid: 'k1', sub: 's', tv: 1, iat: 1.5 }),
    ],
    [
      'a signature that is not 32 bytes',
      `${Buffer.from('{}').toString('base64url')}.${Buffer.alloc(31).toString('base64url')}`,
    ],
  ];

  it.each(cases)('rejects %s', (_why, token) => {
    expect(verifyLink(ring, token, 'wl.manage')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('never throws on any of them, whatever the input', () => {
    for (const [, token] of cases) {
      expect(() => verifyLink(ring, token, 'wl.manage')).not.toThrow();
    }
  });

  it('rejects a payload half that is padded rather than canonical base64url', () => {
    const token = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT });
    const [payload, sig] = token.split('.') as [string, string];
    expect(verifyLink(ring, `${payload}=.${sig}`, 'wl.manage')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a payload half carrying standard-base64 characters', () => {
    const token = mintLink(ring, { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT });
    const [payload, sig] = token.split('.') as [string, string];
    expect(
      verifyLink(ring, `${payload.replace(/-/g, '+').replace(/_/g, '/')}+.${sig}`, 'wl.manage'),
    ).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('key rotation', () => {
  const IAT = 1_755_212_345;
  const manage = { t: 'wl.manage', sub: 'ckv1', tv: 1, iat: IAT } as const;

  it('verifies a token minted under an older key still held by the ring', () => {
    const old = parseKeyRing(`k0:${KEY_B}`);
    const rotated = parseKeyRing(`k1:${KEY_A},k0:${KEY_B}`);
    const result = verifyLink(rotated, mintLink(old, manage), 'wl.manage');
    expect(result.ok).toBe(true);
    expect(result.ok && result.payload.kid).toBe('k0');
  });

  it('signs new tokens with the first entry after rotation', () => {
    const rotated = parseKeyRing(`k1:${KEY_A},k0:${KEY_B}`);
    const result = verifyLink(rotated, mintLink(rotated, manage), 'wl.manage');
    expect(result.ok && result.payload.kid).toBe('k1');
  });

  it('stops verifying the old key once it is dropped from the ring', () => {
    const old = parseKeyRing(`k0:${KEY_B}`);
    const dropped = parseKeyRing(`k1:${KEY_A}`);
    expect(verifyLink(dropped, mintLink(old, manage), 'wl.manage')).toEqual({
      ok: false,
      reason: 'signature',
    });
  });
});
