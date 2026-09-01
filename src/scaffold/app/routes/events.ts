// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import express, { type Router } from 'express';

import type { WorkflowEntry } from '../contract.js';

import {
  pathParam,
  requireSecret,
  type SendToRun,
  type StartWorkflow,
} from './ports.js';

/**
 * `POST /events/:topic` — the door events come in
 * by.
 *
 * One topic does one of two things, and which one
 * depends on the workflows this app carries. A
 * topic some workflow is *triggered* by starts a
 * run. A topic some workflow is *waiting* on wakes
 * the run that is waiting, which is found in the
 * correlation table by a value out of the payload.
 * A topic that is neither is not found.
 *
 * Triggers are looked at first. A topic that both
 * starts a workflow and wakes one is a workflow
 * design nobody has asked for, and picking the
 * trigger keeps the answer predictable if somebody
 * does.
 */

/** A run parked on a wait, and where it parked. */
export type WaitCorrelation = {
  runId: string;
  nodeId: string;
  park: string;
};

export type EventDeps = {
  eventsSecret: string;
  workflows: readonly WorkflowEntry[];
  startWorkflow: StartWorkflow;
  send: SendToRun;
  findWaitCorrelation: (
    topic: string,
    key: string,
  ) => Promise<WaitCorrelation | null>;
};

export function eventRoutes(deps: EventDeps): Router {
  const router = express.Router();

  // The secret is checked before the body is even
  // parsed, so an unauthenticated caller cannot
  // make this process read a megabyte of JSON.
  router.post(
    '/events/:topic',
    requireSecret(deps.eventsSecret),
    express.json({ limit: '1mb' }),
    (request, response) => {
      const topic = pathParam(request, 'topic');

      void handle(deps, topic, request.body, response).catch(
        (error: unknown) => {
          response.status(500).json({ error: String(error) });
        },
      );
    },
  );

  return router;
}

async function handle(
  deps: EventDeps,
  topic: string,
  payload: unknown,
  response: express.Response,
): Promise<void> {
  const triggered = deps.workflows.find(
    (entry) => entry.trigger.mode === 'event' && entry.trigger.topic === topic,
  );
  if (triggered) {
    await start(deps, triggered, topic, payload, response);
    return;
  }

  await deliver(deps, topic, payload, response);
}

async function start(
  deps: EventDeps,
  entry: WorkflowEntry,
  topic: string,
  payload: unknown,
  response: express.Response,
): Promise<void> {
  const check = entry.checkPayload(payload);

  if (!check.ok) {
    response.status(422).json({ error: check.problem });
    return;
  }

  // The run's id is the whole of the idempotency.
  // A redelivered webhook carrying the same key
  // lands on the run that already exists instead
  // of starting a second one.
  const workflowID =
    check.key === undefined ? undefined : `${topic}:${entry.name}:${check.key}`;

  await deps.startWorkflow(entry, workflowID, payload);
  response.status(202).json({ ok: true });
}

async function deliver(
  deps: EventDeps,
  topic: string,
  payload: unknown,
  response: express.Response,
): Promise<void> {
  const waits = deps.workflows
    .flatMap((entry) => entry.eventWaits)
    .filter((candidate) => candidate.topic === topic);

  if (waits.length === 0) {
    response.status(404).json({ error: 'unknown topic' });
    return;
  }

  // Two workflows may wait on one topic — the same
  // provider webhook feeding two flows — and they
  // may read the key out of differently named
  // fields. Reading every delivery through the
  // first one's path would leave the other's runs
  // unreachable, and silently: the route would just
  // go on answering 404.
  const paths = [...new Set(waits.map((wait) => wait.correlationPath))];
  let parked: WaitCorrelation | null = null;

  for (const path of paths) {
    const key = valueAtPath(payload, path);
    if (key === null) continue;

    parked = await deps.findWaitCorrelation(topic, key);
    if (parked) break;
  }

  if (!parked) {
    response.status(404).json({ error: 'no run is waiting for that' });
    return;
  }

  // The park, not the run and node alone: a wait
  // inside a loop parks on the same node every
  // round, and DBOS keeps every key a run was ever
  // woken with, so a key that repeated would have
  // the second round's answer dropped.
  await deps.send(
    parked.runId,
    payload,
    parked.nodeId,
    `${parked.runId}:${parked.nodeId}:${parked.park}`,
  );
  response.status(202).json({ ok: true });
}

/**
 * The value a dot path names, as a string, or null
 * when the path leads nowhere or to something that
 * is not a scalar. A correlation key has to be one
 * value that can be compared to a stored one.
 */
function valueAtPath(payload: unknown, path: string): string | null {
  let cursor: unknown = payload;

  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (typeof cursor === 'string') return cursor === '' ? null : cursor;
  if (typeof cursor === 'number' || typeof cursor === 'boolean') {
    return String(cursor);
  }

  return null;
}
