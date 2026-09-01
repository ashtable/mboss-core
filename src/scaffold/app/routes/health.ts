// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import express, { type Router } from 'express';

import { healthPayload } from '../health.js';

/**
 * `GET /healthz` — the check a platform restarts
 * this app on.
 *
 * The only route here with no secret in front of
 * it: whatever is deciding whether to restart the
 * container has no credentials to offer, and the
 * answer gives nothing away.
 *
 * It reads nothing, which is a trade rather than
 * an oversight — see `health.ts` for both halves
 * of it.
 */
export function healthRoutes(): Router {
  const router = express.Router();

  router.get('/healthz', (_request, response) => {
    response.status(200).json(healthPayload());
  });

  return router;
}
