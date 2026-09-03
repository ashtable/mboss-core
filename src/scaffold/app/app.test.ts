import { describe, expect, it } from 'vitest';

import { buildApp, type AppDeps } from './app.js';
import { parseKeyRing } from './signed-links.js';
import { withServer } from '../../test-support/serve.js';

/**
 * The application, assembled.
 *
 * Each route is tested on its own next door. What
 * is checked here is that every one of them is
 * actually mounted: a route group left out of the
 * assembly passes all of its own tests and answers
 * nothing at all in the running app.
 */

const deps: AppDeps = {
  appTitle: 'Sermon Helper',
  eventsSecret: 'shh',
  ring: parseKeyRing(`k1:${'ab'.repeat(32)}`),
  workflows: [],
  async startWorkflow() {
    return 'wf_1';
  },
  async send() {},
  async workflowOf() {
    return null;
  },
  async findWaitCorrelation() {
    return null;
  },
  async parkOf() {
    return null;
  },
  store: null,
};

/**
 * Every route, by the answer it gives with no
 * credentials and no valid token. Each is a
 * different number from the 404 an unmounted route
 * would give.
 */
const ROUTES = [
  { method: 'GET', path: '/healthz', status: 200 },
  { method: 'POST', path: '/events/anything', status: 401 },
  { method: 'POST', path: '/runs/anything', status: 401 },
  { method: 'GET', path: '/f/rubbish', status: 400 },
  { method: 'POST', path: '/f/rubbish', status: 400 },
  { method: 'GET', path: '/a/rubbish', status: 400 },
];

describe('the assembled app', () => {
  it.each(ROUTES)('answers $method $path', async ({ method, path, status }) => {
    const answered = await withServer(buildApp(deps), async (base) => {
      const response = await fetch(`${base}${path}`, { method });

      return response.status;
    });

    expect(answered).toBe(status);
  });

  it('has nothing at a path it was never given', async () => {
    // Which is what makes the list above evidence
    // rather than a formality: an unmounted route
    // would answer with this.
    const answered = await withServer(buildApp(deps), async (base) => {
      const response = await fetch(`${base}/nowhere`);

      return response.status;
    });

    expect(answered).toBe(404);
  });
});
