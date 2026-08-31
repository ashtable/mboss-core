import express from 'express';
import { describe, expect, it } from 'vitest';

import { withServer } from '../../../test-support/serve.js';
import type { PayloadCheck, WorkflowEntry } from '../contract.js';

import { runRoutes, type RunDeps } from './runs.js';

/**
 * `POST /runs/:workflow` — the only way to start a
 * workflow whose trigger is `manual`.
 *
 * The node catalog accepts a manual trigger, so a
 * person can draw one today. Without this route it
 * would compile to a workflow nothing in the
 * generated app could ever start, which is a worse
 * answer than a small route. It is guarded by the
 * same header as the event ingress, for the same
 * reason.
 */

const SECRET = 'shh';

async function nothing(): Promise<void> {}

function entry(over: Partial<WorkflowEntry> = {}): WorkflowEntry {
  return {
    name: 'monthly_report',
    title: 'Monthly report',
    workflowFn: nothing,
    trigger: { mode: 'manual' },
    checkPayload: (): PayloadCheck => ({
      ok: true,
      key: undefined,
      requesterEmail: undefined,
    }),
    waits: {},
    eventWaits: [],
    ...over,
  };
}

type Started = {
  workflow: string;
  workflowID: string | undefined;
  payload: unknown;
};

function harness(workflows: WorkflowEntry[]) {
  const started: Started[] = [];
  const deps: RunDeps = {
    eventsSecret: SECRET,
    workflows,
    async startWorkflow(target, workflowID, payload) {
      started.push({ workflow: target.name, workflowID, payload });
    },
  };

  const app = express();
  app.use(runRoutes(deps));

  return { app, started };
}

async function post(
  app: express.Express,
  path: string,
  body: unknown,
  headers: Record<string, string> = { 'x-mboss-events-secret': SECRET },
): Promise<{ status: number; body: string }> {
  return withServer(app, async (base) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.text() };
  });
}

describe('starting a manual workflow', () => {
  it('starts it, and lets the SDK name the run', async () => {
    const { app, started } = harness([entry()]);
    const response = await post(app, '/runs/monthly_report', {
      payload: { month: '2026-05' },
    });

    expect(response.status).toBe(202);
    expect(started).toEqual([
      {
        workflow: 'monthly_report',
        workflowID: undefined,
        payload: { month: '2026-05' },
      },
    ]);
  });

  it('takes a run id from the caller when it offered one', async () => {
    // Whoever is pressing the button is the only
    // one who knows whether this is a retry of
    // something they already asked for.
    const { app, started } = harness([entry()]);

    await post(app, '/runs/monthly_report', {
      workflowID: 'monthly_report:2026-05',
      payload: {},
    });

    expect(started[0]?.workflowID).toBe('monthly_report:2026-05');
  });

  it('starts with an empty payload when the body carries none', async () => {
    const { app, started } = harness([entry()]);

    await post(app, '/runs/monthly_report', {});

    expect(started[0]?.payload).toEqual({});
  });
});

describe('the guard', () => {
  it('refuses a request with no secret, and starts nothing', async () => {
    const { app, started } = harness([entry()]);
    const response = await post(app, '/runs/monthly_report', {}, {});

    expect(response.status).toBe(401);
    expect(started).toEqual([]);
  });

  it('refuses one with the wrong secret', async () => {
    const { app, started } = harness([entry()]);
    const response = await post(
      app,
      '/runs/monthly_report',
      {},
      {
        'x-mboss-events-secret': 'guessed',
      },
    );

    expect(response.status).toBe(401);
    expect(started).toEqual([]);
  });
});

describe('a name that does not name a manual workflow', () => {
  it('is not found when nothing is called that', async () => {
    const { app, started } = harness([entry()]);
    const response = await post(app, '/runs/nothing_like_it', {});

    expect(response.status).toBe(404);
    expect(started).toEqual([]);
  });

  it('is not found when the workflow has a trigger of its own', async () => {
    // An event-triggered workflow is started by
    // its event. Starting one from here would put
    // a run into the world with none of the
    // payload its trigger promised it.
    const { app, started } = harness([
      entry({ trigger: { mode: 'event', topic: 'booking.requested' } }),
    ]);
    const response = await post(app, '/runs/monthly_report', {});

    expect(response.status).toBe(404);
    expect(started).toEqual([]);
  });
});

describe('a payload the workflow refuses', () => {
  it('is rejected, and says what was wrong with it', async () => {
    const { app, started } = harness([
      entry({
        checkPayload: (): PayloadCheck => ({
          ok: false,
          problem: 'month is missing',
        }),
      }),
    ]);
    const response = await post(app, '/runs/monthly_report', { payload: {} });

    expect(response.status).toBe(422);
    expect(response.body).toContain('month is missing');
    expect(started).toEqual([]);
  });
});
