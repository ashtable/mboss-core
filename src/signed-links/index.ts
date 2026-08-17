import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compact HMAC-SHA256 bearer tokens: `base64url(payloadJson).base64url(mac)`.
 *
 * This module imports nothing but `node:crypto`, and a sibling test enforces that. It is aliased
 * directly by the cloud services so that resolving it never drags in the rest of this library.
 *
 * Mint inside a durable step, never in a workflow function body: `iat` and `exp` come from the
 * clock, so re-running a workflow would otherwise produce a different token on replay.
 */

export type LinkType = 'wl.manage' | 'app.form' | 'app.artifact';

export type ManagePayload = {
  v: 1;
  t: 'wl.manage';
  kid: string;
  sub: string;
  tv: number;
  iat: number;
};

export type FormPayload = {
  v: 1;
  t: 'app.form';
  kid: string;
  run: string;
  node: string;
  sub: string;
  iat: number;
  exp: number;
};

export type ArtifactPayload = {
  v: 1;
  t: 'app.artifact';
  kid: string;
  art: string;
  sub: string;
  iat: number;
  exp: number;
};

export type LinkPayload = ManagePayload | FormPayload | ArtifactPayload;

/**
 * What a caller supplies. `v` and `kid` are stamped by `mintLink` rather than accepted from the
 * caller: `kid` is `ring.active.kid` by definition, and a caller that passed a different one would
 * produce a token that can never verify — a silent authenticity bug introduced at the call site of
 * the one module whose whole job is authenticity. `v` is the format version this code implements.
 */
export type LinkClaims =
  | Omit<ManagePayload, 'v' | 'kid'>
  | Omit<FormPayload, 'v' | 'kid'>
  | Omit<ArtifactPayload, 'v' | 'kid'>;

export type LinkKeyRing = { active: { kid: string; key: Buffer }; all: Map<string, Buffer> };

export type VerifyResult =
  | { ok: true; payload: LinkPayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'wrong-type' };

/** A kid is both a JSON value and a Map key, so keep it to characters that need no escaping. */
const KID = /^[A-Za-z0-9_-]+$/;
/** 32 bytes, the natural key size for HMAC-SHA256. A shorter key silently weakens every token. */
const KEY = /^[0-9a-fA-F]{64}$/;

/**
 * Parses `"k1:<64-hex>,k0:<64-hex>"`. The first entry signs; every entry verifies, which is what
 * makes rotation possible — prepend a new pair, then drop the old one once the window has passed.
 *
 * Throws on anything malformed rather than skipping the bad entry: a key ring that silently loses
 * an entry verifies fewer tokens than the operator believes it does. Error messages name the
 * offending kid or position and never include key material.
 */
export function parseKeyRing(env: string): LinkKeyRing {
  const entries = env
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) throw new Error('link key ring is empty');

  const all = new Map<string, Buffer>();
  let active: { kid: string; key: Buffer } | undefined;

  for (const [index, entry] of entries.entries()) {
    const separator = entry.indexOf(':');
    if (separator === -1) throw new Error(`link key ring entry ${index} has no ":"`);

    const kid = entry.slice(0, separator).trim();
    const hex = entry.slice(separator + 1).trim();

    if (!KID.test(kid)) throw new Error(`link key ring entry ${index} has a malformed kid`);
    // Reported by position, not by kid: a 64-hex string is itself a valid kid, so an entry written
    // the wrong way round would name the secret here and put it in whatever reads the boot logs.
    if (!KEY.test(hex))
      throw new Error(`link key ring entry ${index} is not a 64-character hex key`);
    if (all.has(kid)) throw new Error(`link key ring has a duplicate kid "${kid}"`);

    const key = Buffer.from(hex, 'hex');
    all.set(kid, key);
    active ??= { kid, key };
  }

  // `entries` is non-empty and every iteration either throws or assigns, so this always holds.
  if (!active) throw new Error('link key ring is empty');

  return { active, all };
}

/**
 * Rejects a numeric claim that `verifyLink` would refuse. Minting is the only place this mistake
 * can still be pointed at its cause: a fractional `iat` (a forgotten `Math.floor`) or a non-finite
 * `exp` mints a perfectly well-formed token that no service can ever accept, and the failure then
 * surfaces somewhere else entirely as `malformed`, which reads like tampering rather than a bug at
 * the call site.
 */
function requireInteger(claim: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`link claim "${claim}" must be an integer, got ${String(value)}`);
  }
}

/**
 * Builds the payload with its keys in one fixed order per type, so minting the same claims twice
 * always produces byte-identical JSON and therefore an identical token. The switch is exhaustive
 * so that a fourth link type cannot be added without deciding its key order here.
 */
function canonical(kid: string, claims: LinkClaims): LinkPayload {
  requireInteger('iat', claims.iat);

  switch (claims.t) {
    case 'wl.manage':
      requireInteger('tv', claims.tv);
      return { v: 1, t: 'wl.manage', kid, sub: claims.sub, tv: claims.tv, iat: claims.iat };
    case 'app.form':
      requireInteger('exp', claims.exp);
      return {
        v: 1,
        t: 'app.form',
        kid,
        run: claims.run,
        node: claims.node,
        sub: claims.sub,
        iat: claims.iat,
        exp: claims.exp,
      };
    case 'app.artifact':
      requireInteger('exp', claims.exp);
      return {
        v: 1,
        t: 'app.artifact',
        kid,
        art: claims.art,
        sub: claims.sub,
        iat: claims.iat,
        exp: claims.exp,
      };
    default: {
      const unreachable: never = claims;
      throw new Error(`unknown link type: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Signs with the ring's active key. The MAC covers the payload JSON bytes, not the encoded text. */
export function mintLink(ring: LinkKeyRing, claims: LinkClaims): string {
  const bytes = Buffer.from(JSON.stringify(canonical(ring.active.kid, claims)), 'utf8');
  const sig = createHmac('sha256', ring.active.key).update(bytes).digest();
  return `${bytes.toString('base64url')}.${sig.toString('base64url')}`;
}

/**
 * Node's base64url decoder is permissive — it drops invalid characters rather than throwing — so
 * decoding alone proves nothing about the input. Re-encoding and comparing is the real check: only
 * a canonical base64url string survives the round trip.
 */
function decodeStrict(part: string): Buffer | null {
  const buf = Buffer.from(part, 'base64url');
  return buf.toString('base64url') === part ? buf : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the decoded claim set by hand. There is no schema library here on purpose — this module
 * has no dependencies, and that is the property the cloud services rely on.
 */
function asPayload(value: unknown): LinkPayload | null {
  if (!isRecord(value)) return null;
  if (value['v'] !== 1) return null;
  if (typeof value['kid'] !== 'string' || typeof value['sub'] !== 'string') return null;
  if (!Number.isInteger(value['iat'])) return null;

  const str = (key: string): boolean => typeof value[key] === 'string';
  const int = (key: string): boolean => Number.isInteger(value[key]);

  switch (value['t']) {
    case 'wl.manage':
      return int('tv') ? (value as LinkPayload) : null;
    case 'app.form':
      return str('run') && str('node') && int('exp') ? (value as LinkPayload) : null;
    case 'app.artifact':
      return str('art') && int('exp') ? (value as LinkPayload) : null;
    default:
      return null;
  }
}

/**
 * Verifies in a fixed order: parse, then signature, then expiry, then type. One consequence worth
 * knowing is that an expired token of the wrong type reports `expired`, because expiry is checked
 * first.
 *
 * Whether the caller should honour a valid token is a separate question this module cannot answer:
 * it has no database, so checking a manage token's version against the subscriber's current one,
 * or whether a run is still waiting, belongs to the caller. That is why the failure reasons stop
 * at four and none of them concerns state.
 */
export function verifyLink(ring: LinkKeyRing, token: string, expect: LinkType): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const [encodedPayload, encodedSig] = parts as [string, string];
  if (encodedPayload.length === 0 || encodedSig.length === 0) {
    return { ok: false, reason: 'malformed' };
  }

  const bytes = decodeStrict(encodedPayload);
  const sig = decodeStrict(encodedSig);
  if (!bytes || !sig) return { ok: false, reason: 'malformed' };
  // Guarding the length here is also what keeps `timingSafeEqual` from throwing on a mismatch.
  if (sig.length !== 32) return { ok: false, reason: 'malformed' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const payload = asPayload(parsed);
  if (!payload) return { ok: false, reason: 'malformed' };

  // An unknown kid is structurally fine but cannot be authenticated, which is the same outcome for
  // the caller as a bad signature: we cannot prove this token is ours.
  const key = ring.all.get(payload.kid);
  if (!key) return { ok: false, reason: 'signature' };

  const expected = createHmac('sha256', key).update(bytes).digest();
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: 'signature' };

  // A token is valid at exactly `exp` and expires the second after. This is deliberately not JWT,
  // whose `exp` is exclusive. Manage links carry no `exp` at all — they are revoked by bumping the
  // subscriber's token version instead.
  if ('exp' in payload && Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, reason: 'expired' };
  }

  if (payload.t !== expect) return { ok: false, reason: 'wrong-type' };

  return { ok: true, payload };
}
