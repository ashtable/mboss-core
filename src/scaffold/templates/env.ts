/**
 * `.env` and `.env.example`, from one builder.
 *
 * The two files differ in exactly two values — the
 * minted key ring and the minted events secret —
 * so building both from one function is what makes
 * "the example names every variable the real one
 * does" true by construction rather than by a
 * habit of editing both.
 *
 * The seven optional variables are commented out
 * rather than left empty. An empty value is a
 * value, and the schema rejects an empty string
 * where it accepts an absent one, so a project
 * that shipped `S3_BUCKET=""` would refuse to
 * boot over a feature nobody had asked for.
 */

export type EnvSecrets = { linkKeys: string; eventsSecret: string };

/**
 * The ring the house uses wherever a real one is
 * not wanted: all zeros but the last digit, which
 * parses, so a misconfigured app boots and fails
 * on a signature rather than on start-up.
 */
export const PLACEHOLDER_LINK_KEYS =
  'k1:0000000000000000000000000000000000000000000000000000000000000001';

export const PLACEHOLDER_EVENTS_SECRET = 'dev-events-secret';

export function envFile(secrets: EnvSecrets): string {
  return `# Written by mBoss when this project was created.
#
# Gitignored, and the deploy ignores it too, so
# the values here reach a local run and nothing
# else. Set them on the platform for a deployment
# — the README has the command.

# This app's own database, and DBOS's bookkeeping
# beside it. The compose file replaces both with
# the postgres service hostname.
DATABASE_URL="postgres://app:app@localhost:5432/app"
DBOS_SYSTEM_DATABASE_URL="postgres://app:app@localhost:5432/app"

# Where this app answers. Every signed link is
# minted against it, so in production it is the
# public origin rather than this one.
APP_BASE_URL="http://localhost:3000"

# Leave this alone. DBOS only recovers runs whose
# application version matches the running one, so
# bumping it strands every run already in flight.
# Bump it when that is what you want.
APP_VERSION="1"
PORT="3000"

# The signing ring behind every form and artifact
# link: kid:key pairs, the first signing and all
# of them verifying. Rotate by prepending a new
# pair and dropping the old one once the links it
# signed have expired. Replacing it outright
# invalidates every link already sent.
LINK_KEYS="${secrets.linkKeys}"

# The header an event sender has to present to
# start a workflow.
EVENTS_SECRET="${secrets.eventsSecret}"

# The mail API key pair, then the API root. Point
# the root at a mail sink to keep a local run off
# the real provider.
TWILIO_API_KEY="SK-dev-twilio-api-key"
TWILIO_API_SECRET="dev-twilio-api-secret"
TWILIO_EMAIL_BASE_URL="https://comms.twilio.com"
MAIL_FROM="hello@example.com"

# The object store behind file uploads and
# artifact links. All five or none: with none of
# them set the artifact route answers 503 and the
# form renders its dropzone disabled, which beats
# a form that silently drops a file.
# S3_ENDPOINT="http://localhost:9000"
# S3_REGION="us-east-1"
# S3_BUCKET="artifacts"
# S3_ACCESS_KEY_ID=""
# S3_SECRET_ACCESS_KEY=""

# Reserved for model routing. Nothing in a
# generated app reads them yet.
# GLOO_AI_CLIENT_ID=""
# GLOO_AI_CLIENT_SECRET=""
`;
}

/**
 * The committed reference copy. Same variables,
 * same comments, and two values that are obviously
 * not secrets.
 */
export const ENV_EXAMPLE = envFile({
  linkKeys: PLACEHOLDER_LINK_KEYS,
  eventsSecret: PLACEHOLDER_EVENTS_SECRET,
});
