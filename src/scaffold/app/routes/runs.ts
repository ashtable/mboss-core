// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import express, { type Router } from 'express';

import type { WorkflowEntry } from '../contract.js';

import { pathParam, requireSecret, type StartWorkflow } from './ports.js';

/**
 * `POST /runs/:workflow` — starting a workflow by
 * hand.
 *
 * A workflow whose trigger is `manual` has no
 * event to arrive and no schedule to fire, so
 * without this there would be no way to start one
 * at all. It is guarded by the same header as the
 * event ingress: a route that starts workflows is
 * never unauthenticated, however it is reached.
 *
 * Only manual workflows. An event-triggered one is
 * started by its event, and starting it from here
 * would put a run into the world with none of the
 * payload its trigger promised it.
 *
 * The body is `{ payload, workflowID }`, both
 * optional. Passing a `workflowID` is how a caller
 * makes pressing the button twice mean one run:
 * only the caller knows whether the second press
 * was a retry of the first.
 */

export type RunDeps = {
  eventsSecret: string;
  workflows: readonly WorkflowEntry[];
  startWorkflow: StartWorkflow;
};

type RunRequest = { payload?: unknown; workflowID?: unknown };

export function runRoutes(deps: RunDeps): Router {
  const router = express.Router();

  router.post(
    '/runs/:workflow',
    requireSecret(deps.eventsSecret),
    express.json({ limit: '1mb' }),
    (request, response) => {
      const entry = deps.workflows.find(
        (candidate) =>
          candidate.name === pathParam(request, 'workflow') &&
          candidate.trigger.mode === 'manual',
      );

      if (!entry) {
        response.status(404).json({ error: 'no manual workflow by that name' });
        return;
      }

      const body = (request.body ?? {}) as RunRequest;
      const payload = body.payload ?? {};
      const check = entry.checkPayload(payload);

      if (!check.ok) {
        response.status(422).json({ error: check.problem });
        return;
      }

      const workflowID =
        typeof body.workflowID === 'string' ? body.workflowID : undefined;

      void deps
        .startWorkflow(entry, workflowID, payload)
        .then(() => {
          response.status(202).json({ ok: true });
        })
        .catch((error: unknown) => {
          response.status(500).json({ error: String(error) });
        });
    },
  );

  return router;
}
