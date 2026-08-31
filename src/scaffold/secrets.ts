import { randomBytes } from 'node:crypto';

/**
 * The two secrets a new project is born with.
 *
 * They are minted here rather than by the caller
 * so that a project is usable the moment it is
 * created — an app whose first boot fails on a
 * missing key ring teaches the wrong thing about
 * the tool. Both are written into `.env`, which is
 * gitignored, and neither is ever regenerated:
 * minting a second ring would invalidate every
 * form link already in somebody's inbox.
 */

/** 32 bytes, the key size HMAC-SHA256 wants. */
const SECRET_BYTES = 32;

/**
 * A one-key ring, in the format the link module
 * parses: `kid:key`, the first entry signing and
 * every entry verifying.
 *
 * `k1` rather than `k0`, so the first rotation
 * prepends `k2` and the numbering keeps reading
 * in the order the keys were made.
 */
export function mintLinkKeys(): string {
  return `k1:${randomBytes(SECRET_BYTES).toString('hex')}`;
}

/**
 * The shared secret an event sender puts in its
 * `x-mboss-events-secret` header. Hex rather than
 * base64 so it survives a shell, an env file and a
 * webhook configuration form without escaping.
 */
export function mintEventsSecret(): string {
  return randomBytes(SECRET_BYTES).toString('hex');
}
