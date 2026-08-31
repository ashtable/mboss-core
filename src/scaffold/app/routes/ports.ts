// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import type { Request, RequestHandler } from 'express';

import type { WorkflowEntry } from '../contract.js';

/**
 * What the routes are handed, and the one guard
 * two of them share.
 *
 * Everything a route does that touches DBOS, the
 * database or the network arrives as a function on
 * a dependency object rather than as an import.
 * That is what lets the route tests run over a
 * real socket with real status codes and no
 * database anywhere near them, and it is also the
 * honest shape: a route's job is to decide, and
 * these are the decisions' inputs.
 */

/**
 * The header that guards every route which can
 * start a workflow. A workflow-starting endpoint
 * is never unauthenticated.
 */
export const SECRET_HEADER = 'x-mboss-events-secret';

/**
 * The guard, as the first handler in a route's own
 * chain rather than as a mounted middleware.
 * Written that way so it is visible in the line
 * that declares the route: a guard mounted
 * somewhere else is one a later route can be added
 * in front of.
 */
export function requireSecret(secret: string): RequestHandler {
  return (request, response, next) => {
    if (request.header(SECRET_HEADER) !== secret) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    next();
  };
}

/**
 * One path parameter, as a string.
 *
 * Express types a parameter as a string or an
 * array of them, because a wildcard pattern
 * captures several segments. Every route here
 * declares `:name`, which is always the one
 * string, and this is where that is said once
 * rather than at every use.
 */
export function pathParam(request: Request, name: string): string {
  const value = request.params[name];

  return typeof value === 'string' ? value : '';
}

/**
 * Starting a run. `workflowID` absent means the
 * SDK mints one, which is at-most-once per
 * delivery and no more.
 */
export type StartWorkflow = (
  target: WorkflowEntry,
  workflowID: string | undefined,
  payload: unknown,
) => Promise<void>;

/**
 * Waking a run that is asleep on a node. The key
 * is what makes a redelivered event, or a
 * double-submitted form, land exactly once.
 */
export type SendToRun = (
  runId: string,
  message: unknown,
  nodeId: string,
  idempotencyKey: string,
) => Promise<void>;
