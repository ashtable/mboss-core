import express from 'express';
import { describe, expect, it } from 'vitest';

import { withServer } from '../../../test-support/serve.js';

import { healthRoutes } from './health.js';

/**
 * `GET /healthz` — the check a platform restarts
 * this app on.
 */

describe('the health route', () => {
  it('answers that the process is serving', async () => {
    const app = express();
    app.use(healthRoutes());

    const answer = await withServer(app, async (base) => {
      const response = await fetch(`${base}/healthz`);

      return { status: response.status, body: await response.json() };
    });

    expect(answer).toEqual({ status: 200, body: { ok: true } });
  });

  it('needs no secret, because it says nothing worth having', async () => {
    // Every other route in this app is guarded.
    // This one is reached by whatever is deciding
    // whether to restart the container, which has
    // no credentials to offer.
    const app = express();
    app.use(healthRoutes());

    const status = await withServer(
      app,
      async (base) => (await fetch(`${base}/healthz`)).status,
    );

    expect(status).toBe(200);
  });
});
