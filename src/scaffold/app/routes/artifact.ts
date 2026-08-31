// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import express, { type Router } from 'express';

import type { ArtifactStore } from '../artifacts.js';
import { renderInvalidPage } from '../pages/form.js';
import { verifyLink, type LinkKeyRing } from '../signed-links.js';

import { pathParam } from './ports.js';

/**
 * `GET /a/:token` — reading a file a workflow
 * produced.
 *
 * The route checks the token, asks the object
 * store for a signed URL and redirects to it. It
 * never carries the bytes: a download proxied
 * through here would occupy the process that is
 * also running workflows for as long as the
 * transfer took, and for a file of any size that
 * is a long time.
 *
 * With no object store configured there is nothing
 * to redirect to, and the route says so rather
 * than serving an error page that looks like the
 * link was bad.
 */

export type ArtifactDeps = {
  ring: LinkKeyRing;
  store: ArtifactStore | null;
};

export function artifactRoutes(deps: ArtifactDeps): Router {
  const router = express.Router();

  router.get('/a/:token', (request, response) => {
    const token = pathParam(request, 'token');
    const result = verifyLink(deps.ring, token, 'app.artifact');

    if (!result.ok) {
      response.status(400).type('html').send(renderInvalidPage(result.reason));
      return;
    }
    if (deps.store === null) {
      response.status(503).json({ error: 'no object store is configured' });
      return;
    }

    const { payload } = result;
    const key = payload.t === 'app.artifact' ? payload.art : '';

    void deps.store
      .presign(key)
      .then((url) => {
        // No body. `redirect` would write a short
        // HTML courtesy page, and this route's one
        // promise is that nothing of the file, and
        // nothing at all, comes through here.
        response.status(302).location(url).end();
      })
      .catch((error: unknown) => {
        response.status(502).json({ error: String(error) });
      });
  });

  return router;
}
