// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { mintLink, type LinkKeyRing } from './signed-links.js';

/**
 * The two links this app sends people: one that
 * opens a form, one that unlocks a file.
 *
 * The token is the whole credential — there is no
 * account behind it and nothing to sign in to — so
 * both carry an expiry and both are scoped to one
 * run and one thing within it.
 *
 * `now` is a parameter rather than a call to the
 * clock. Minting happens inside a durable step,
 * and a step that read the clock itself would mint
 * a different token every time the workflow
 * replayed.
 */

/**
 * The longest a form link lasts, whatever the wait
 * it opens is configured for.
 *
 * A credential sitting in an inbox for a year,
 * with nothing that can revoke it, is a different
 * proposition from one that expires while the
 * person is still likely to act on it. mBoss
 * refuses to compile a wait longer than this, so
 * nothing it generates reaches the clamp below —
 * that one is here for a caller of your own.
 */
export const FORM_LINK_MAX_SECONDS = 2592000;

export function formUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/f/${token}`;
}

export function artifactUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/a/${token}`;
}

export type FormLinkInput = {
  ring: LinkKeyRing;
  /** The origin this app answers on. */
  baseUrl: string;
  runId: string;
  nodeId: string;
  /** Who the link is for. */
  to: string;
  /** The wait's own timeout. Capped above. */
  expiresInSeconds: number;
  /** Milliseconds since the epoch. */
  now: number;
};

export function mintFormLink(input: FormLinkInput): string {
  // Whole seconds: the token format takes integers
  // and refuses anything else at the point of
  // minting, which is the only place the mistake
  // can still be pointed at its cause.
  const iat = Math.floor(input.now / 1000);
  const life = Math.min(input.expiresInSeconds, FORM_LINK_MAX_SECONDS);

  return formUrl(
    input.baseUrl,
    mintLink(input.ring, {
      t: 'app.form',
      run: input.runId,
      node: input.nodeId,
      sub: input.to,
      iat,
      exp: iat + life,
    }),
  );
}

export type ArtifactLinkInput = {
  ring: LinkKeyRing;
  baseUrl: string;
  /** The storage key the link unlocks. */
  key: string;
  to: string;
  expiresInSeconds: number;
  now: number;
};

export function mintArtifactLink(input: ArtifactLinkInput): string {
  const iat = Math.floor(input.now / 1000);

  return artifactUrl(
    input.baseUrl,
    mintLink(input.ring, {
      t: 'app.artifact',
      art: input.key,
      sub: input.to,
      iat,
      exp: iat + input.expiresInSeconds,
    }),
  );
}
