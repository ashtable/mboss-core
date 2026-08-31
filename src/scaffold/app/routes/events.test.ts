import express from 'express';
import { describe, expect, it } from 'vitest';

import { withServer } from '../../../test-support/serve.js';
import type { PayloadCheck, WorkflowEntry } from '../contract.js';

import { eventRoutes, type EventDeps } from './events.js';

/**
 * The door events come in by.
 *
 * It is the one unauthenticated-looking surface a
 * generated app exposes, so the first two tests
 * here are about the header and the last thing
 * every one of them asserts is that nothing
 * started. A route that answers 401 and starts the
 * workflow anyway looks exactly like a route that
 * works.
 */

const SECRET = 'shh';

async function nothing(): Promise<void> {}

function entry(over: Partial<WorkflowEntry> = {}): WorkflowEntry {
  return {
    name: 'groom_booking',
    title: 'Groom booking',
    workflowFn: nothing,
    trigger: {
      mode: 'event',
      topic: 'booking.requested',
      idempotencyKeyPath: 'requestId',
    },
    checkPayload: (payload): PayloadCheck => ({
      ok: true,
      key: (payload as { requestId?: string }).requestId,
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
type Sent = {
  runId: string;
  message: unknown;
  nodeId: string;
  key: string;
};

function harness(workflows: WorkflowEntry[]) {
  const started: Started[] = [];
  const sent: Sent[] = [];
  const correlations = new Map<
    string,
    { runId: string; nodeId: string; park: string }
  >();

  const deps: EventDeps = {
    eventsSecret: SECRET,
    workflows,
    async startWorkflow(target, workflowID, payload) {
      started.push({ workflow: target.name, workflowID, payload });
    },
    async send(runId, message, nodeId, key) {
      sent.push({ runId, message, nodeId, key });
    },
    async findWaitCorrelation(topic, key) {
      return correlations.get(`${topic} ${key}`) ?? null;
    },
  };

  const app = express();
  app.use(eventRoutes(deps));

  return { app, started, sent, correlations };
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

describe('the secret header', () => {
  it('refuses a request that carries none, and starts nothing', async () => {
    const { app, started } = harness([entry()]);
    const response = await post(
      app,
      '/events/booking.requested',
      { requestId: 'r1' },
      {},
    );

    expect(response.status).toBe(401);
    expect(started).toEqual([]);
  });

  it('refuses one that carries the wrong secret', async () => {
    const { app, started } = harness([entry()]);
    const response = await post(
      app,
      '/events/booking.requested',
      {},
      {
        'x-mboss-events-secret': 'guessed',
      },
    );

    expect(response.status).toBe(401);
    expect(started).toEqual([]);
  });

  it('refuses one whose secret is the right length but wrong', async () => {
    // Every other case here differs in length as
    // well as in content, so a comparison that
    // agreed about nothing but length would pass
    // all of them.
    const { app, started } = harness([entry()]);
    const response = await post(
      app,
      '/events/booking.requested',
      {},
      { 'x-mboss-events-secret': 'ssh' },
    );

    expect(response.status).toBe(401);
    expect(started).toEqual([]);
  });

  it('answers before the body is parsed, so rubbish is still a 401', async () => {
    // The guard is the first handler in the chain
    // on purpose: an unauthenticated caller must
    // not be able to make this process read a
    // megabyte of JSON. A 400 here would mean the
    // parser had run first.
    const { app, started } = harness([entry()]);
    const status = await withServer(app, async (base) => {
      const response = await fetch(`${base}/events/booking.requested`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mboss-events-secret': 'guessed',
        },
        body: '{ not json at all',
      });

      return response.status;
    });

    expect(status).toBe(401);
    expect(started).toEqual([]);
  });
});

describe('a topic nothing is listening for', () => {
  it('is not found, and starts nothing', async () => {
    const { app, started } = harness([entry()]);
    const response = await post(app, '/events/nobody.cares', {});

    expect(response.status).toBe(404);
    expect(started).toEqual([]);
  });
});

describe('a payload the trigger refuses', () => {
  it('is rejected, and says which part of it was wrong', async () => {
    const { app, started } = harness([
      entry({
        checkPayload: (): PayloadCheck => ({
          ok: false,
          problem: 'requestId is missing',
        }),
      }),
    ]);
    const response = await post(app, '/events/booking.requested', {});

    expect(response.status).toBe(422);
    expect(response.body).toContain('requestId is missing');
    expect(started).toEqual([]);
  });
});

describe('an event that starts a workflow', () => {
  it('gives the run an id built from the topic, name and key', async () => {
    // The id is the whole of the idempotency: a
    // redelivered webhook carrying the same key
    // lands on the run that already exists rather
    // than starting a second one.
    const { app, started } = harness([entry()]);
    const response = await post(app, '/events/booking.requested', {
      requestId: 'r1',
    });

    expect(response.status).toBe(202);
    expect(started).toEqual([
      {
        workflow: 'groom_booking',
        workflowID: 'booking.requested:groom_booking:r1',
        payload: { requestId: 'r1' },
      },
    ]);
  });

  it('leaves the id to the SDK when the trigger names no key', async () => {
    // At-most-once per delivery, and no dedup
    // across deliveries. That is what a trigger
    // without an idempotency key is asking for,
    // and inventing one here would be a guess at
    // which field identified the event.
    const { app, started } = harness([
      entry({
        trigger: { mode: 'event', topic: 'booking.requested' },
        checkPayload: (): PayloadCheck => ({
          ok: true,
          key: undefined,
          requesterEmail: undefined,
        }),
      }),
    ]);

    await post(app, '/events/booking.requested', { requestId: 'r1' });

    expect(started[0]?.workflowID).toBeUndefined();
  });
});

describe('an event a sleeping run is waiting for', () => {
  function waiting() {
    const built = harness([
      entry({
        eventWaits: [
          {
            nodeId: 'await_reply',
            topic: 'twilio.reply',
            correlationPath: 'from',
          },
        ],
      }),
    ]);
    built.correlations.set('twilio.reply +15551234', {
      runId: 'wf_1',
      nodeId: 'await_reply',
      park: 'park_one',
    });

    return built;
  }

  it('delivers it to that run, under the node it is parked on', async () => {
    const { app, sent } = waiting();
    const payload = { from: '+15551234', body: 'yes please' };
    const response = await post(app, '/events/twilio.reply', payload);

    expect(response.status).toBe(202);
    expect(sent).toEqual([
      {
        runId: 'wf_1',
        message: payload,
        nodeId: 'await_reply',
        key: 'wf_1:await_reply:park_one',
      },
    ]);
  });

  it('keys each park apart, so a later one is still wakeable', async () => {
    const { app, sent, correlations } = waiting();
    const payload = { from: '+15551234', body: 'yes please' };

    await post(app, '/events/twilio.reply', payload);
    await post(app, '/events/twilio.reply', payload);

    // Two deliveries of one webhook carry one key,
    // which is what makes the second one a
    // duplicate rather than a second answer.
    expect(sent.map((one) => one.key)).toEqual([
      'wf_1:await_reply:park_one',
      'wf_1:await_reply:park_one',
    ]);

    // A wait inside a loop parks on the same node
    // again, and the key has to move with it. DBOS
    // makes it the primary key of its message
    // table and never deletes the row, so a run
    // whose second park reused the first park's
    // key could never be woken again at all.
    correlations.set('twilio.reply +15551234', {
      runId: 'wf_1',
      nodeId: 'await_reply',
      park: 'park_two',
    });
    await post(app, '/events/twilio.reply', payload);

    expect(sent.at(-1)?.key).toBe('wf_1:await_reply:park_two');
  });

  it('is not found when no run is parked on that key', async () => {
    const { app, sent } = waiting();
    const response = await post(app, '/events/twilio.reply', {
      from: '+15559999',
    });

    expect(response.status).toBe(404);
    expect(sent).toEqual([]);
  });

  it('is not found when the payload carries no key at all', async () => {
    const { app, sent } = waiting();
    const response = await post(app, '/events/twilio.reply', { body: 'hi' });

    expect(response.status).toBe(404);
    expect(sent).toEqual([]);
  });

  it('needs the secret too, and delivers nothing without it', async () => {
    const { app, sent } = waiting();
    const response = await post(
      app,
      '/events/twilio.reply',
      { from: '+15551234' },
      {},
    );

    expect(response.status).toBe(401);
    expect(sent).toEqual([]);
  });
});
