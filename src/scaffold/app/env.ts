// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { z } from 'zod';

/**
 * The environment this app boots on, checked once
 * and completely.
 *
 * Nothing here is read at module scope: `readEnv`
 * takes the source, so importing this file runs no
 * validation and every other module stays
 * importable with an empty environment. The boot
 * calls it first, before anything opens a
 * connection.
 *
 * Add your own variables to the schema below and
 * to `.env.example` together. mBoss checks that
 * the two agree.
 */

/**
 * A URL this app concatenates paths onto. A
 * trailing slash would double up in
 * `${APP_BASE_URL}/f/${token}`, producing a link
 * that looks right in the source and is wrong in
 * the inbox.
 */
const baseUrlSchema = z
  .string()
  .min(1)
  .transform((value) => value.replace(/\/+$/, ''));

/**
 * Eight variables the app cannot run without,
 * three with defaults, and seven that are
 * genuinely optional — an absent one turns a
 * feature off rather than breaking the app.
 *
 * The object is deliberately left a plain object
 * rather than being wrapped in a `.transform()`,
 * so its keys can be read straight off `.shape`.
 */
export const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // DBOS keeps its bookkeeping in its own schema,
  // so this is normally the same database as the
  // one above. It is a separate variable because
  // pointing DBOS elsewhere is a real thing to
  // want and deriving it would take that away.
  DBOS_SYSTEM_DATABASE_URL: z.string().min(1),
  // Where this app answers. Every signed link is
  // minted against it, so it has to be the origin
  // a recipient can actually reach.
  APP_BASE_URL: baseUrlSchema,
  // DBOS only recovers a run whose application
  // version matches the running one, and it
  // derives that version from a hash of the
  // workflow source unless told otherwise.
  // Regenerating rewrites every workflow file, so
  // without a pinned version the first redeploy
  // after an edit strands every run in flight —
  // and the runs most likely to be in flight are
  // the ones waiting days for a person. Leave
  // this alone; bump it only when you want a new
  // generation that deliberately does not adopt
  // the old runs.
  APP_VERSION: z.string().min(1).default('1'),
  // Railway injects this and routes only the port
  // it injected, so it is read rather than fixed.
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // The signing ring behind every /f and /a link:
  // `kid:key` pairs, the first signing and all of
  // them verifying. Rotate by prepending a new
  // pair and dropping the old one once the links
  // it signed have expired.
  LINK_KEYS: z.string().min(1),
  // The shared secret an event sender puts in its
  // `x-mboss-events-secret` header. A route that
  // starts workflows is never unauthenticated.
  EVENTS_SECRET: z.string().min(1),
  // The mail API's credentials, as a key pair:
  // the key's SID, then its secret.
  TWILIO_API_KEY: z.string().min(1),
  TWILIO_API_SECRET: z.string().min(1),
  // The API root, without the version segment —
  // the client appends that, so a local run can
  // point this at a mail sink and get the same
  // paths.
  TWILIO_EMAIL_BASE_URL: baseUrlSchema.default('https://comms.twilio.com'),
  MAIL_FROM: z.string().min(1),
  // The object store behind file uploads and
  // artifact links. All five or none: with none
  // of them set the artifact route answers 503
  // and the form renders its dropzone disabled,
  // which is a better answer than a form that
  // silently drops a file.
  S3_ENDPOINT: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Reserved for the model-routing credentials.
  // Nothing in a generated app reads them yet, so
  // they are optional: refusing to boot over a
  // credential no code uses would be a lie about
  // what the app needs.
  GLOO_AI_CLIENT_ID: z.string().min(1).optional(),
  GLOO_AI_CLIENT_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Throws with every missing or malformed variable
 * named at once.
 *
 * An app that boots without its key ring or its
 * mail credentials can do nothing but fail one
 * workflow at a time, so the failure has to be
 * loud and total rather than per-variable and
 * lazy. Reporting them one at a time also turns
 * a first deployment into a queue of restarts.
 */
export function readEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`invalid environment: ${problems}`);
}
