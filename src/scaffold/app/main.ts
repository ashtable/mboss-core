// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { DBOS } from '@dbos-inc/dbos-sdk';
import { PrismaDataSource } from '@dbos-inc/prisma-datasource';

import { schedules, workflows } from '../workflows/index.js';

import { artifactStoreFromEnv } from './artifacts.js';
import { buildApp } from './app.js';
import { prismaClient } from './db.js';
import { readEnv } from './env.js';
import { applyAndPruneSchedules } from './schedules.js';
import { parseKeyRing } from './signed-links.js';
import { findWaitCorrelation, parkOf } from './waits.js';

/**
 * Starting the app. The only module here that does
 * anything when it is imported.
 *
 * The order below is load-bearing, and each step
 * fails in a way that looks like something else if
 * it is moved.
 *
 * Importing the workflow registry registers every
 * workflow and constructs the datasource, and both
 * have to happen before `launch`, which is what
 * publishes the registry and initialises the
 * datasources. An import is how that is guaranteed
 * rather than remembered.
 *
 * The datasource's own table is created before
 * `launch` too, because launch dispatches recovery
 * and a recovered run reaches for that table
 * immediately.
 *
 * The listener comes last, and the `await` in
 * front of `launch` is part of that. The ingress
 * route starts workflows; `DBOS.startWorkflow`
 * throws only until launch is under way, because
 * the flag it checks is set early — before launch
 * has initialised its datasources or its executor.
 * So a server bound before the await fails exactly
 * the requests that arrive during a deployment,
 * first with that throw and then, for the rest of
 * launch, against an executor that is not ready,
 * which fails less legibly than the throw.
 *
 * No queue is registered. Fan-out in a generated
 * workflow is a chunked `Promise.allSettled`
 * inside the run, so there is no queue to declare.
 */

/**
 * The name DBOS files this application's runs and
 * schedules under.
 *
 * Fixed, and deliberately not `APP_NAME`. This is
 * an identity inside the system database, and
 * schedule ownership is keyed on it: renaming it
 * would hide every schedule already recorded, so
 * the boot that followed a rename would find none
 * to prune and the old ones would go on firing.
 * The name people see is `APP_NAME`, which is free
 * to change for exactly that reason. Each app made
 * by mBoss has its own system database, so this
 * only needs to be stable, not unique.
 */
const DBOS_APP_NAME = 'mboss-app';

async function main(): Promise<void> {
  const env = readEnv(process.env);

  DBOS.setConfig({
    name: DBOS_APP_NAME,
    systemDatabaseUrl: env.DBOS_SYSTEM_DATABASE_URL,
    // Pinned rather than derived. Left to itself
    // DBOS hashes the workflow source, so the
    // first deployment after a regeneration would
    // strand every run already in flight — and the
    // runs most likely to be in flight are the
    // ones waiting days for a person.
    applicationVersion: env.APP_VERSION,
  });

  await PrismaDataSource.initializeDBOSSchema(prismaClient());
  await DBOS.launch();
  await applyAndPruneSchedules(schedules);

  const app = buildApp({
    appTitle: env.APP_NAME,
    eventsSecret: env.EVENTS_SECRET,
    ring: parseKeyRing(env.LINK_KEYS),
    workflows,
    async startWorkflow(entry, workflowID, payload) {
      // The one cast in the app, and it is here on
      // purpose: the registry holds workflows that
      // each take their own input type, and this
      // is the point a checked payload crosses in.
      await DBOS.startWorkflow(entry.workflowFn, { workflowID })(
        payload as never,
      );
    },
    async send(runId, message, nodeId, idempotencyKey) {
      await DBOS.send(runId, message, nodeId, idempotencyKey);
    },
    findWaitCorrelation: (topic, key) => findWaitCorrelation(topic, key),
    parkOf: (runId, nodeId) => parkOf(runId, nodeId),
    store: artifactStoreFromEnv(env),
  });

  // Railway and most other platforms inject the
  // port and route only the one they injected, and
  // they reach the container by its address on
  // their own network rather than on loopback.
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`${env.APP_NAME} is serving on port ${env.PORT}`);
  });

  const stop = (): void => {
    // Stop taking requests first, then let DBOS
    // close its connections. The other order drops
    // a request that is already being served.
    server.close(() => {
      void DBOS.shutdown();
    });
  };

  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
