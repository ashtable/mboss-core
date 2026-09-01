// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import express from 'express';

import { artifactRoutes, type ArtifactDeps } from './routes/artifact.js';
import { eventRoutes, type EventDeps } from './routes/events.js';
import { formRoutes, type FormDeps } from './routes/form.js';
import { healthRoutes } from './routes/health.js';
import { runRoutes, type RunDeps } from './routes/runs.js';

/**
 * The application: five route groups and nothing
 * else.
 *
 * Everything that touches DBOS, the database or
 * the network arrives as a function on `deps`
 * rather than as an import, so this whole file and
 * every route under it can be exercised over a
 * real socket with nothing running behind it. The
 * wiring to the real thing is in `main.ts`, which
 * is the only module here with side effects.
 *
 * There is no error-handling middleware. Each
 * route answers its own failures, because what to
 * say depends on whether the caller is a person
 * holding a link or a webhook holding a secret,
 * and one handler for both would have to guess.
 */

export type AppDeps = ArtifactDeps & EventDeps & FormDeps & RunDeps;

export function buildApp(deps: AppDeps): express.Express {
  const app = express();

  app.use(healthRoutes());
  app.use(eventRoutes(deps));
  app.use(runRoutes(deps));
  app.use(formRoutes(deps));
  app.use(artifactRoutes(deps));

  return app;
}
