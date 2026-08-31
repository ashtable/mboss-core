/**
 * `.mboss/conventions.md` — the document a coding
 * agent reads before it writes a handler.
 *
 * It is written once, when the project is created,
 * and is the project's own from then on: nothing
 * regenerates it. So everything in it has to be
 * true for the life of the project rather than
 * true of one generation of it.
 *
 * Four of its sections are decisions made
 * elsewhere in mBoss that a handler author cannot
 * discover from the canvas and will otherwise get
 * wrong: how a transaction handler has to write,
 * what a per-item output really carries, what the
 * ingress actually validates, and which loop
 * settings have no compiled effect yet.
 */
export function conventions(name: string): string {
  return `# Code-behind conventions

How ${name} is put together, and the handful of rules a handler in \`lib/\`
has to follow. mBoss wrote this file once, when the project was created. It
is yours now; nothing regenerates it.

## Who owns which directory

- \`.mboss/workflows/\` holds the workflow documents. They are the source of
  truth for everything under \`src/workflows/\`.
- \`src/workflows/\` is compiler-owned. Every file there opens with a
  do-not-edit header and is rewritten in full on the next generation. Edits
  are lost silently, because regeneration does not read what it replaces.
- \`src/app/\` is the runtime, and it is yours. mBoss wrote it when the
  project was created and will not touch it again.
- \`lib/\` is your code-behind: the handlers the blocks call.

## Writing a handler

- One exported function per file, named. No default exports — the compiler
  emits a named import per source file, and a default has no name to import.
- Type both ends. The block declares an input type and an output type, and
  mBoss checks the declaration against the real signature before it will
  compile the workflow.
- \`async\` or not, either works. The compiler wraps every call.

**A handler's input and output must be data.** Values are written to the
workflow database on the way out of one block and read back on the way into
the next, so only data makes the trip. A function comes back missing; a class
instance comes back as a plain object with its methods gone; a stream or an
open connection was never a value in the first place. mBoss refuses to
compile a workflow whose handler declares one of those, and names the
offending member.

Buffers are refused too, and for a different reason: they would travel, as an
array of bytes through the workflow database, which is the wrong home for a
payload of unknown size. Put the bytes in the object store and pass the key.

\`Date\`, \`Map\`, \`Set\`, \`RegExp\` and \`BigInt\` all survive and are fine to use.

## A transaction block writes through \`appDb.client\`

A block of kind \`transaction\` compiles to a call inside
\`appDb.runTransaction(...)\`, and the handler must do its writes through
\`appDb.client\`, imported from \`../src/app/db.js\` — the client scoped to that
transaction. A handler that constructs a \`PrismaClient\` of its own writes
outside the run's transaction, which is exactly the exactly-once property the
kind exists to give you. The failure is loud (the client throws when it is
touched outside a transaction) but it is a run-time failure, and this note is
what stops it.

## A "for each" block hands the next block a list

Its declared output names the type of one item, and the value the next block
receives is an array of those. The block catalog cannot yet say "a list of
Receipt", so the two disagree on purpose. Where it matters, the mismatch
shows up as a type error at build time inside \`src/workflows/\` — in
generated code, about a real problem in the drawing.

## What the event ingress actually checks

\`POST /events/:topic\` verifies the shared secret, then checks that the dot
paths the trigger declares resolve to non-empty strings in the payload. It
does not validate the payload against the declared type: the manifest carries
type names, not their structure. Treat a handler's input as untrusted and
check what you rely on.

## Loop settings that have no compiled effect yet

- \`minRounds\` is inert. Nothing in the block catalog carries an exit
  predicate, so "between the minimum and the maximum, with no signal" honestly
  compiles to the maximum. Set the maximum to what you actually want.
- \`models\` is authored but not compiled. Nothing in a generated app talks to
  a model provider yet, so the field is carried in the document and ignored.

Neither is a bug to report, and neither will change silently — when they do
compile, this file will say so.

## Leave \`APP_VERSION\` alone

DBOS recovers a run only when the run's application version matches the
running process. Left to itself it derives that version from a hash of the
workflow source — and regeneration rewrites every file under
\`src/workflows/\`, so the first redeploy after any edit to a workflow would
orphan every run in flight. The runs most likely to be in flight are the ones
waiting days for a person to answer a form.

So \`APP_VERSION\` pins it. Bump it only when you want a new generation that
deliberately does not adopt the old runs.

If a redeploy does strand runs, they are not lost. Find them and move them
onto the running version:

\`\`\`ts
const stranded = await DBOS.listWorkflows({
  applicationVersion: '<the old value>',
  status: ['PENDING'],
});

for (const run of stranded) {
  await DBOS.forkWorkflow(run.workflowID, 0, {
    applicationVersion: '<the new value>',
  });
}
\`\`\`

A fork replays from the step you name, carrying the original's inputs and the
outputs of every step before it, under a new run id.

## The vendored slots

\`.mboss/mcp/\` holds the MCP server bundle and \`.mboss/skills/mboss/\` holds
the skill; \`.claude/skills/mboss/\` is the copy Claude Code reads. All three
arrive from the mBoss VS Code extension or from a release archive — this
project cannot build them. Until they are filled, \`.mcp.json\` points at a
server that is not there, and an agent reports the connection as failed
rather than as missing.

## Regeneration

\`npm run build\` is \`tsc --noEmit\`. Regeneration runs from the mBoss canvas
in VS Code or through the MCP server; \`build\` grows that half when the
command-line tool lands.

Generated code is committed on purpose, so that a change to a workflow shows
up in a pull request as the code it produces.
`;
}
