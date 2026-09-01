// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { PrismaDataSource } from '@dbos-inc/prisma-datasource';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { readEnv } from './env.js';

/**
 * This app's own database, and the seam a workflow
 * runs a transaction through.
 *
 * Two things here are load-bearing and pull in
 * opposite directions, which is why they are
 * written the way they are.
 *
 * The datasource is constructed here, at import.
 * Constructing it registers it with DBOS, and
 * `DBOS.launch()` initialises every registered
 * datasource before it dispatches recovery — so a
 * datasource built after launch is invisible to
 * exactly the runs recovery is about to replay.
 * Importing the workflow registry is what pulls
 * this module in, and that happens before launch
 * by construction.
 *
 * The client, on the other hand, is built by the
 * thunk below rather than beside the datasource,
 * so importing this module reads no environment
 * and opens no connection. That is what lets a
 * test, a lint or a type-check import it with
 * nothing running.
 *
 * Prisma 7 will not take a connection string in
 * `schema.prisma`, so the client needs a driver
 * adapter and the string comes from the
 * environment here.
 */

let client: PrismaClient | undefined;

/**
 * The app's Prisma client, built once on first
 * use.
 *
 * Inside a workflow transaction use
 * `appDb.client`, which is the transaction-scoped
 * client. This one is for everything outside a
 * transaction: the route handlers, and any code of
 * yours that is not part of a run.
 */
export function prismaClient(): PrismaClient {
  client ??= new PrismaClient({
    adapter: new PrismaPg({
      connectionString: readEnv(process.env).DATABASE_URL,
    }),
  });

  return client;
}

export const appDb = new PrismaDataSource<PrismaClient>('app-db', prismaClient);
