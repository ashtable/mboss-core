/**
 * The project's README.
 *
 * Three things in it are here because leaving them
 * out produces a working command with a broken
 * outcome: `railway domain`, without which a
 * healthy deployed service has no address;
 * `railway variables`, without which it boots with
 * none of its configuration and dies naming eight
 * missing variables; and `npm install` before the
 * first compose build, because the Dockerfile
 * copies a lock file that npm has to write first.
 */
export function readme(name: string): string {
  return `# ${name}

A durable app built with mBoss. Its workflows are drawn on the mBoss canvas,
compiled into \`src/workflows/\`, and run on DBOS against Postgres.

## Who owns what

- \`.mboss/workflows/\` — the workflow documents. The source of truth.
- \`lib/\` — your code-behind handlers. Hand-written, typed, tested.
- \`src/workflows/\` — generated. Every edit here is lost on the next
  generation.
- \`src/app/\` — the runtime. Yours from the moment this project was created.
- \`prisma/\` — the database schema and its migrations.

\`.mboss/conventions.md\` is the longer version, and it is what a coding agent
reads before it touches \`lib/\`.

## Run it

\`\`\`
npm install
docker compose up --build
\`\`\`

\`npm install\` comes first because the image build copies \`package-lock.json\`,
which npm writes. The app then answers on http://localhost:3000, and
\`/healthz\` is the quickest way to see that it came up.

Postgres is published on the loopback only, so \`npx prisma migrate dev\` from a
shell on this machine reaches it while nothing else on the network does.

## Deploy it

\`\`\`
npm run deploy
railway domain
\`\`\`

\`railway up\` never exposes a service on its own. Without \`railway domain\`
there is a healthy service nobody can reach.

It also honours \`.gitignore\`, and \`.env\` is in there — so the deployed
service starts with none of its configuration. Set it once:

\`\`\`
railway variables \\
  --set DATABASE_URL=... \\
  --set DBOS_SYSTEM_DATABASE_URL=... \\
  --set APP_BASE_URL=https://your-domain \\
  --set LINK_KEYS=... \\
  --set EVENTS_SECRET=... \\
  --set MAIL_FROM=... \\
  --set TWILIO_API_KEY=... \\
  --set TWILIO_API_SECRET=...
\`\`\`

Copy \`LINK_KEYS\` and \`EVENTS_SECRET\` out of \`.env\` rather than minting new
ones: a new ring invalidates every form link already in somebody's inbox.
Everything \`.env.example\` comments out is genuinely optional — without the
object store the artifact route answers 503 and file upload fields render
disabled, and nothing reads the model-routing credentials yet.

## Generated code is committed

\`src/workflows/\` is checked in on purpose, so that it is reviewable in a pull
request and CI type-checks it like everything else. \`npm run build\` is
\`tsc --noEmit\` today: regeneration runs from the mBoss VS Code extension or
through the MCP server, and \`build\` grows that half when the command-line tool
lands.
`;
}
