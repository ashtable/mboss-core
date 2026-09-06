# CONTEXT

The words this repository uses for the things it is made of.

`@mboss/core` is the shared engine behind mBoss: a person draws a workflow on a
canvas, and this library is what decides whether the drawing means anything and
what TypeScript it becomes. Most of the file below is about that journey — what
a person draws, the code behind it, what a run does while it is happening, and
what a generated project is.

It is here because the same concepts are named in a dozen module headers and
nowhere together, and because agents write documents in this repository as well
as people. A term is in this file when getting it wrong would cost somebody
something. Everything is quoted or paraphrased from the code, with the file and
line that says it best.

**This is a glossary, not the design.** The full narrative — the product, the
extension, the MCP server, the cloud repos — is `design-docs/current-design.md`
in the sibling repository. Where the two disagree about a name, that document is
older than this checkout and this file is read off the code.

**Decisions live in `docs/adr/`.** Several of the shapes this vocabulary
describes look like mistakes until you know why they are the way they are — two
separate ways of refusing a workflow, five files copied byte-for-byte into a
generated project, a filesystem nothing mocks. Those are written down as ADRs so
they are argued once rather than re-litigated every time somebody reads the tree.

## A note on two pairs of words

Both halves of each pair are correct, and they are not interchangeable.

**node and block.** `node` is the schema's word: the field is `nodes`, the type
is `WorkflowNode`, and every id, edge end and rule refers to a node. `block` is
the word for a person: it is what a sentence in a diagnostic, a page or an email
says, because a person dragged a box onto a canvas and never met a node. Prose
written for a reader says block; code and schemas say node.

**drawing and document.** The `drawing` is what a person made and what they are
looking at; the `workflow document` is the JSON on disk it is saved as. The
compiler refuses things about the drawing and reports them to whoever is looking
at it. `design-docs/current-design.md` uses `document` throughout and does not
use `drawing` as a noun — if you are reading that document, read `document`
wherever this file says drawing.

## The drawing

The vocabulary of the canvas itself: the picture a person makes, the file it is saved as, and the pieces it is built from.

### drawing

What a person made on the canvas: the workflow itself, as a picture of blocks and wires. On disk it is a workflow document, and that document is the source of truth for everything the compiler writes.

The repo says "the drawing" for the person's intent, "the document" for the JSON on disk, and "the canvas" for the editor showing it. Messages are phrased for whoever is looking at the drawing — the compiler refuses a too-long wait "while there is still somebody looking at the drawing" rather than failing at build time. Never "the graph": that word is reserved for the walk built over a document.

`src/compile/emit-linear.ts:1373`

### workflow document

One workflow as a person drew it, saved as JSON at `.mboss/workflows/<name>.workflow.json`: a name, a revision, the nodes and the edges between them. It is the one semantic model the canvas, the MCP server, validation and the compiler all share, and each of them parses it through the schemas rather than trusting the file, because agents write it as well as the canvas.

Not the generated TypeScript and not the canvas. `src/workflows/` is rewritten in full from the document on every generation, so anyone who edits the output instead of the document loses the edit silently. A file that is there but is not a workflow throws rather than reading as absent — treating a corrupted document as a blank slate is how an edit becomes a deletion. Also called the Workflow IR, or just "the document"; "design" in this repo means the visual design of emails and pages, never the workflow.

`src/ir/workflow.ts:7`

### block

One box on the canvas: a thing the workflow does. Every block has a readable id (`parse_request`), a title, an optional input and output type, and optionally a handler behind it.

The schema field is `nodes` and the type is `WorkflowNode`, but every sentence written for a person says "block". A block's id is not a label: it names the function the compiler emits, it appears in diagnostics, and three other places point at it — the ends of an edge, the members of a loop's body, and the email a form wait is waiting on — so a rename has to move all of them together. Not "task", "activity" or "stage".

`src/ir/types.ts:95`

### kind

Which of the ten things a block is: trigger, step, transaction, apiCall, codeStep, branch, loop, durableWait, approval, emailSend. The kind decides what config the block carries, which ports it has, which drawer of the canvas palette it is offered from, and what the compiler emits for it.

"Kind" is the block's nature; "type" in this codebase means a TypeScript type name from the code-behind that a block declares as its `in` or `out`. Ten is deliberate and closed — queues, child workflows, compensation and map blocks are not kinds — because a kind is far cheaper to add than to remove once workflows on disk use it. `NODE_PALETTE` is the only place a kind's human-facing name is written down: `durableWait` is "Wait", `codeStep` is "Code step", `apiCall` is "API call".

`src/ir/catalog.ts:10`

### port

A named way out of a block, in the order the canvas draws them. Most blocks have exactly one, `out`; a branch has one per case plus its fall-through `elsePort`, and an approval has `approved` and `rejected`.

A port is how an edge says which outcome it belongs to, so two cases sharing one leaves nothing able to decide which wire carries which case — refused at the schema rather than by a rule, because it makes the document meaningless rather than merely wrong. Validation, layout and the compiler all call one `portsOf`, since a port list that differs between them shows up as an edge that validates, draws, and then compiles into a branch nothing reaches.

`src/ir/catalog.ts:326`

### edge

A wire from one block's port to another block, optionally naming the type that travels along it. `from.port` defaults to `out`, because only branches and approvals have more than one.

"Wire" is the word most of the prose and the canvas use for the same thing. A wire says a value travels; it does not say where the value came from — that is the producer, which has to be worked out rather than read off the wire. A wire also carries a type whether or not it names one, so leaving it unnamed is not the same as there being no type.

`src/ir/types.ts:113`

### back edge

The wire that closes a loop: an edge marked `back`, drawn from one of a branch's cases to a block the run has already been through. It has to leave by a case port — that case is what decides whether the loop goes round again — and land on a block that every path to that branch already ran.

Declared on the drawing rather than inferred, because it is the one legal way to draw a cycle; every other cycle is refused as a workflow that loops back on itself without saying so. Its bound lives on the branch case (`maxIterations`, `onExhausted`), not on any loop block, and the compiler calls the loop it makes a repeat. "What a run executes" follows back edges; "what lies ahead" never does.

`src/validate/rules.ts:270`

### guard

A condition on a block: when it is false the block does not run and produces nothing. Written as a predicate over the value flowing into it.

The canvas and the diagnostics say "condition". Whoever reads a guarded block's value must carry the same condition or require no input at all, or the canvas draws a clean typed wire for a value that will not be there — and "the same" means the same path, operator and compared value, because the rule that checks it and the compiler that groups consecutive blocks under one `if` use the same comparison.

`src/validate/rules.ts:631`

### predicate

A test on one value: a dot-path naming what to look at, an operator, and — for everything but `exists` and `nonempty` — something to compare against. The same shape does three jobs: a block's guard, a branch case, and the condition that shows a form field.

All three read a value the same way on purpose; three answers to "what does `a.b.c` mean" is three chances for the canvas to draw one thing and the app to do another. The empty path names the whole value rather than a field of it, which is how a case on a branch that runs code tests the answer itself.

`src/ir/types.ts:39`

### producer

The block whose value another block reads: the nearest block above it that binds a value and that every path to it goes through, with the trigger as the floor. Steps, code steps, API calls and transactions bind a value; a wait for a person or an event binds what arrived; a wait on the clock, a branch and an approval bind nothing.

It has to be a block every run passes through — one that ran down only one arm has not run when the other arm was taken, so a reference to what it bound would be a reference to nothing. Validation and the compiler must give the same answer, because the compiler names a local after the block that bound it; where two ways into a block name different producers, it refuses rather than quietly picking one.

`src/ir/values.ts:61`

### pattern

A whole workflow somebody starts from instead of an empty canvas: a document plus the handler files it names, shipped together, so that pressing Use leaves a project that draws, validates and compiles without anybody writing a line first.

Deliberately not called a template — `scaffold/templates/` already means the files the scaffold copies into a new project, and sharing the word would make every sentence about either one ambiguous. Use writes the handlers first and then applies the document through the same door `workflow_create` uses; nothing is generated. The set of them is the gallery, and each carries a hand-authored card: a sentence, one of three shelves, a few tags, and the document's first four distinct block kinds as glyphs.

`src/patterns/types.ts:10`

## The blocks

The ten kinds a block can be, in eight entries — a code step and an API call are a step wearing a different label, and a form has no block of its own.

### trigger

How a run starts: by hand, on an inbound event, or on a schedule. The canvas shows friendly knobs (run / start / repeat / ends) over the cron expression and bounds they add up to.

Event mode is also the ingress contract: `idempotencyKeyPath` is what makes a redelivered webhook start one run rather than two, and `requesterEmailPath` is the only place an address for the requesting user can come from — so an approval or email addressed to `requestingUser` under a manual or scheduled trigger is refused, because the address has nowhere to come from.

`src/ir/catalog.ts:63`

### step

The ordinary unit of durable work: one named function from the code-behind, run and checkpointed, so a restart resumes after it rather than doing it again. A step has no config of its own — what it does is its handler, and how it behaves is the shared `retry`, `forEach` and `guard` modifiers.

Two other kinds are this same block: a code step is a step with no config at all, the escape hatch whose whole story is the handler it names; an API call compiles exactly like a step, and its `service` name is display and convention only — nothing dials it for you. `forEach` (fan-out) is a modifier on an ordinary step, not a kind of its own: the canvas draws one durable step running N times over an array in its input.

`src/ir/catalog.ts:30`

### transaction

A step whose handler writes through the app's own datasource client, so the write joins the run's database transaction and is rolled back with it. Reserved strictly for the app's own co-located database.

A write to anything external is a step, not a transaction: inside a transaction a call out is neither checkpointed nor undone by the rollback, and nothing else in the system will say so — the generated code type-checks and the fault turns up months later as a payment taken twice. So a transaction whose handler calls out is refused (V16) before the run. The handler must write through `appDb.client`; constructing its own client writes outside the transaction.

`src/ir/catalog.ts:38`

### branch

The block that chooses where a run goes next. Its cases are ordered and the first match wins, anything matching nothing leaves by the fall-through port, and at least one case is required — a branch with none is just an edge drawn with extra steps.

A plain branch reads a field out of the value that reached it. A branch handed a handler is a decision: the function runs as a step of its own and each case names one whole answer it can give — a boolean, or one member of a union of string literals — so a case still shaped like a predicate compiles into a test against something the decision is not. What the decision returned is deliberately not in scope downstream: a block after a branch reads whatever was flowing when the branch was reached. The compiler calls a branch's ways out arms.

`src/ir/catalog.ts:106`

### loop

A bounded repeat over a contiguous chain of blocks, listed by id in the loop's `body`, entered at the first member and left from the last, running between `minRounds` and `maxRounds` times.

This is one of the two ways to loop, and the compiler calls it a counted loop; the other is a back edge, whose bound lives on a branch case rather than on any block. The body's order comes from the block's own list rather than from the graph, because that list is what the author sees, and anything that reaches into the middle of it — or leaves from the middle of it — compiles into something other than what the canvas draws. A value produced inside a loop and read after it has to be carried out into a name declared alongside the loop.

`src/ir/catalog.ts:139`

### durable wait

A block where the run stops until something arrives: a person submitting a form, an inbound event, or simply the clock. `onTimeout` is required, because a wait with no answer still has to do something and leaving that implicit is how runs hang forever.

`durableWait` in the document, "Wait" in the palette. A form wait names the email that sends the form — never the form itself, which has no block of its own — while an event wait declares both halves of its correlation: the path read from the run's own value when it parks, and the path read from the inbound event. A form or event wait writes a correlation row before it parks and binds what arrived; a timer wait writes no row, binds nothing, and lets the value that was flowing carry straight past.

`src/ir/catalog.ts:177`

### approval

Asking a person to decide: one block on the canvas, and three things in the generated file — an email carrying a single-decision form, a durable wait on the reply, and a two-way branch on the `{ approved: boolean }` that comes back. Its ways out are the `approved` and `rejected` ports.

Sugar, and it stays sugar: no pass rewrites the drawing into those three, and its two arms go through exactly the layout a branch's do. Do not call it a branch, though — the two differ wherever "what happens next" is computed: an approval's list starts where the arms meet again, or, where they never meet, at the approved arm's own first block, because the arm the person did not take is not their future.

`src/ir/catalog.ts:203`

### email send

Mail the run sends: a required subject and Markdown body, addressed to a literal address or to `requestingUser`, attaching nothing, a form to fill in, or a link to an artifact.

A form lives on the email rather than in a block of its own, because a form never exists without the email that delivers its link — and the wait that collects the answers names the email, not the form. Every field of that form needs an id of its own: an id is how an answer says which question it answers, and two fields sharing one wakes the run with one answer where two were asked while the declared type goes on claiming both.

`src/ir/catalog.ts:266`

## The code behind the drawing

The handlers a person writes by hand, and what mBoss learns by reading them.

### code-behind

The handlers a person writes by hand, under `lib/`: the real work the blocks call out to. Typed at both ends, never touched by mBoss, and the one tree of a generated project a person is unambiguously meant to edit.

`lib/` is yours, `src/app/` is the runtime, `src/workflows/` is compiler-owned and rewritten in full on every generation — confusing the first and the last means editing files whose edits vanish silently. The code and its prose say code-behind everywhere; not "user code" or "business logic". `.mboss/conventions.md` is the document a coding agent reads before it writes one, and nothing regenerates it.

`src/scaffold/templates/conventions.ts:37`

### handler

The named export in the code-behind that a block runs, named by export name only. Whether it is async, what it takes and what it returns are facts about the function, read off the scan rather than off the drawing.

Only the five kinds that run code of the author's take one — step, transaction, apiCall, codeStep and branch; the emitter drops a handler named on a trigger, loop, wait, approval or email on the floor. A block may carry none at all, because the canvas creates blocks before the code behind them exists, so "no handler" is a warning rather than an error. And a handler's signature beats what the block declares: it takes what its signature says whatever the block claims about its own input.

`src/ir/types.ts:75`

### manifest

What a scan of the project's code-behind found: every exported function a block can name, its parameters and return type, the values it decides between, the calls in its body that reach another system, the types that cannot travel between blocks, and the type errors found on the way. The canvas draws its palette from it and validation resolves handlers and declared types against it.

Derived and cached at `.mboss/manifest.json`, gitignored, keyed on a hash of the sources rather than on the build that wrote it — so a cache an older build left behind is served until `lib/` next changes, which is why an absent field reads as "the scan did not say" rather than "there is none". The scan never throws on a type error, because code mid-edit is the ordinary state and the canvas has to keep drawing; that error becomes a manifest error beside whatever did scan cleanly. Validation given no manifest is not validation that found nothing: the rules that read one stay silent.

`src/manifest/index.ts:2`

### handler fit

The single answer to whether a given function may sit behind a given block, asked by the picker in the Inspector, the drop target on a node and validation alike. It answers with the first thing wrong, as a code rather than a sentence: no-handler-kind, external-call, too-many-params, input-mismatch, output-mismatch, not-a-decision.

That reason is a misfit. One implementation, because a function the picker offers and the drop target refuses is a bug a person has no way to explain; codes rather than prose, because each surface writes its own sentence and core owns only the diagnostic's. V13 reports only the two declared-type misfits — asking the wider question there let a reason the rule stays quiet about hide one it does not.

`src/validate/handler-fit.ts:9`

### external call

A call in a handler's body that reaches another system: the global `fetch`, or a call resolving into one of Node's own networking modules. Recorded as the callee as it was written, where the thing called is declared, and the line, so a person reading a finding can go and find it.

Deliberately narrow. A call into a package, or into a helper of the project's own that itself calls out, goes unreported, and `fs` and `child_process` are not on the list — the alternative is a guess, and a wrong guess refuses a legitimate handler with no way for anyone to argue.

`src/manifest/types.ts:18`

### non-serializable

A place a declared type cannot survive the trip between two blocks: a function, a class with methods, a Buffer, a stream, an open connection. Values are written to the workflow database on the way out of one block and read back on the way into the next, so only data makes it across.

A Buffer is the one refusal that is policy rather than mechanism — it would travel, as an array of bytes, which is the wrong home for a payload of unknown size; the bytes belong in the object store and the handler passes the key. The walk stops at types an installed package declares, so `Date`, `Map`, `Set` and `URL` are not faults.

`src/manifest/types.ts:106`

## Checking and saving an edit

How a drawing is judged and how an edit reaches the disk — the same door for a person and for an agent.

### diagnostic

One finding validation reports about a drawing: a stable code (V01 to V16), a severity, a sentence a person reads on the canvas, and the node or edge it is about so the canvas can draw it there.

Two severities and the split does real work: a warning is something the author has not done yet, an error is something the drawing says that cannot be true — which is what makes a half-built draft a legal document. Codes are a wire contract that tools match on, so a rule that changes meaning takes a new number rather than widening an old one. A diagnostic is mBoss's complaint about the drawing; a manifest error is TypeScript's complaint about the code-behind, and the two travel separately.

`src/validate/diagnostic.ts:6`

### can compile

Whether a drawing can become a running app: exactly one trigger, no errors, and no missing handler. Stricter than the save gate — which asks only whether anything found is fatal — in exactly the two places where a legal draft is still not a program.

Errors refuse a write and leave the file exactly as it was; warnings stop nothing, which is why a successful apply still returns diagnostics — they are how the author finds out what is still undone. Treat this as the same question as "has errors" and you either block saving perfectly ordinary drafts or generate a project whose blocks call functions that are not there. An island — a block nothing wires back to the trigger — is only a warning: the compiler emits what the trigger reaches and leaves the rest out in silence.

`src/validate/index.ts:55`

### spec

The whole workflow somebody wants, stated in full — never a patch. It is the document minus its envelope: no `revision`, no `$schema`, no `version`, no `name`, because those belong to the file it is written into.

Full-document semantics is what an agent can get right: one statement that either validates or does not, where a sequence of patches has an order, a half-applied middle, and a meaning that depends on what it was applied to. A spec is also silent about coordinates, and silence means leave the layout alone — the one place a spec becomes a document copies the positions already there onto it, so an agent's write never throws away an arrangement somebody made by hand.

`src/apply/proposal.ts:34`

### revision

How many times a workflow has been written, counting from 1. It says how many times, not which content, and it only ever goes up — including through an undo.

Every apply and propose sends the `baseRevision` it believes it is editing against, and `null` is a claim too: "there is no such workflow yet". A mismatch is REVISION_CONFLICT on a direct apply and PROPOSAL_STALE on an approved proposal — two codes because the remedies differ, and both returned as data rather than thrown. The check only means what it says because one advisory lock at `.mboss/.lock` serialises read, validate, snapshot and write around it.

`src/ir/workflow.ts:18`

### proposal

An edit an agent wants to make, written down and not yet made: a file holding the spec, its diff summary, its diagnostics, who proposed it, and the revision it was based on. The workflow itself is untouched until a person approves.

A file rather than a message because the canvas may not be running — a live canvas draws it as a preview, a headless agent prints the same summary as text — and its diagnostics are stored rather than recomputed on read, so the preview a person approves is the one the agent was shown. A newer proposal supersedes the workflow's earlier outstanding one, so only ever one can be approved; every way of not being in `proposed` status answers PROPOSAL_NOT_FOUND, which does not mean the file is missing.

`src/apply/proposal.ts:21`

## A run

What exists while a workflow is running, and afterwards — a run is nothing more than the rows it wrote as it went.

### run

One execution of a drawn workflow, filed under a run id. Concretely it is the list of rows DBOS checkpointed as it went, one per step, in function-id order.

A run is a list of rows, not an object with state you can inspect: which arm of a branch a run took is exactly what the ledger does not say. The prose says "run"; the wire and the SDK say `workflowID`. The id a route answers with is the one the run was actually filed under, and passing your own is how pressing a button twice means one run.

`src/compile/replay.ts:23`

### row

One thing the SDK checkpointed for a run: the name it recorded, the function id it sits at — its position in the run, counted from zero — and whether it finished or failed.

Rows are the only evidence about a run that already happened, so every question about one has to be answerable from names in id order plus the drawing in front of somebody. A hole — an id with no row — is not a gap in the record; it is where the run is parked, and nothing below a park has run. Some rows belong to the SDK's own primitives (`DBOS.recv`, `DBOS.sleep`, and `getStatus`, the one it records without the prefix) rather than to any block, and a row naming no block of this drawing is an answer, not a failure.

`src/compile/replay.ts:46`

### recorded name

The name a step writes into the ledger: the block's id, then one piece for each region enclosing it — `find_slot`, `find_slot.r2`, `await_form.r1.resend.2`. It is what says which block a recorded row belongs to.

Not cosmetic. DBOS compares it at each function id when it replays, so a name that moves — a renamed block, a region added or dropped — turns every recovery into an error days after the change that caused it. Every value a region contributes comes from checkpointed control flow, a round counter or a chunk offset, never a clock or a random number. Distinct from the registered name (the workflow's own snake_case name, which compiling does not change) and from the local a block's result binds to.

`src/compile/names.ts:2`

### park

A run sitting still at a wait until something reaches it, and the occasion of its waiting: a fresh park id is minted as the correlation row is written, kept while the run sleeps, and gone the moment it wakes. The row beside it says which run is parked on which node, under which topic and key.

The park is what makes the key that wakes a run unique per occasion — keyed on run and node alone, a run that waits inside a loop would be woken once for its whole life and every later round silently dropped, because DBOS marks a consumed message rather than deleting it. A row that is present means a run genuinely still waiting, which is the check a form link cannot make for itself. Not the parked block of the canvas, which is only a block nobody has dragged yet.

`src/scaffold/app/waits.ts:39`

### replay

Starting a run again from one of its rows, with everything before that row reused rather than re-run. DBOS calls it a fork: the original's inputs and the outputs of every earlier step come along, under a new run id.

What may be replayed from is worked out before anybody clicks, because the fork is created before it can fail. Rows are withheld with a reason so an editor can say why a row has no button — `sdk-owned`, `inside-wait`, `parked-here`, and `link-scoped`, which sends a person one block back to the email that minted the link, since beginning again at the register row would correlate a new run to an answer that can only come back for the old one.

`src/compile/replay.ts:19`

## The generated project

The trees of the app mBoss writes, and which of them is yours.

### project

A real DBOS TypeScript app on disk — its own package.json, container, Postgres schema and README — that mBoss creates once and then compiles workflows into. A directory is an mBoss project exactly when it has a `.mboss/` control directory.

Scaffolding happens once in a project's life and nothing it wrote is ever regenerated, which is why it refuses a directory already holding `.mboss/` or `package.json`: a second scaffold would mint a fresh key ring and stop every form link already in somebody's inbox from verifying, and overwrite a runtime its owner has been editing. A project name may carry hyphens where a workflow name may not, because no file is named after it.

`src/apply/paths.ts:19`

### compiler-owned

Said of `src/workflows/`: every file there opens with a do-not-edit header and is rewritten in full on the next generation, which does not read what it replaces.

An edit there is lost silently. The one file the app's boot imports is the registry, `src/workflows/index.ts`, which carries each workflow's title and whether it is scheduled — a compiled workflow written without its registry entry is a file the running app never sees. Prettier and eslint both skip the directory while tsconfig still includes it: a reformat would make the next generation produce a diff that is not a change, and code nobody reads is the code that most needs type-checking.

`src/scaffold/templates/conventions.ts:32`

### the runtime

`src/app/` in a generated project: the express app, the mail sender, the form pages, the wait bookkeeping. mBoss writes it when the project is created and it is the owner's from that moment — editable, and never rewritten.

Unlike `src/workflows/`, an edit to the runtime survives. Its master copy lives in this repo as real, type-checked source that is read and copied verbatim, never imported — importing it would pull express, the DBOS SDK and a Prisma client into the import graph of a library other repos nest as source. `src/app/contract.ts` is the declarations the compiler-owned code and the runtime both agree on; it declares types and imports nothing.

`src/scaffold/templates/conventions.ts:35`

### unsupported

A drawing that is a legal draft — validation passed it, the canvas is happy with it — that this compiler nonetheless has no way to write code for. It comes back as the `UNSUPPORTED` result, naming the one block to look at when it is about a block rather than about the whole document.

Not the same as validation refusing a drawing that is wrong, and not the same as a crash out of the compiler, which is a bug in mBoss — reporting a `TypeError` to somebody as "your workflow is unsupported" sends them looking in the wrong place, so only this one refusal is ever caught.

`src/compile/unsupported.ts:2`

## Reaching a person

Everything the running app sends outward, and everything that comes back in.

### node email

The one message a block sends, and the one call a workflow makes to send anything. The subject and body belong to whoever drew the workflow; the card around them is fixed, and exactly one of four things is attached: a form to fill in, a decision to make, a file to read, or nothing at all.

The link is minted inside this call, so generated workflow code contains no minting at all — a workflow body that minted its own would produce a different token on every replay and leave the recipient holding one that no longer matched. The block the mail attaches is not always the block that sends it: an approval mails its own link, and a form email may be sent by a block ahead of the wait it opens.

`src/scaffold/app/mail.ts:12`

### signed link

The URL this app mails a person, whose token is the entire credential: `/f/<token>` opens a form or an approval, `/a/<token>` unlocks a file. There is no account behind it and nothing to sign in to, so each one is scoped to a single run and a single thing within it, and each expires — thirty days at most, whatever the wait it opens is configured for.

The token proves the holder was sent the link and nothing more; whether the run is still waiting is a separate check against the correlation table, or a form could be submitted a second time days later against a run that had moved on. It is signed from the key ring in `LINK_KEYS`, where the first entry signs and every entry verifies — that split is what makes rotation possible without invalidating links already in inboxes — and the ring is minted once and never regenerated.

`src/scaffold/app/links.ts:7`

### ingress

`POST /events/:topic` — the door events come in by, guarded by the events secret, answering either that a run was started or that a parked run was woken. One topic either starts a run or wakes one waiting on it, and triggers are looked at first.

It verifies the secret and checks that the dot paths the trigger declares resolve to non-empty strings; it does not validate the payload against a declared type, so a handler's input is untrusted. `POST /runs/:workflow` is the sibling door for manual workflows, behind the same header. Waits on a person register under the reserved `mboss.form` topic, so a bare `form` topic from a forms provider would wake page-parked runs with a payload of the wrong shape.

`src/scaffold/app/routes/events.ts:16`

### requester

The person a run was started on behalf of, found by reading the trigger payload at the path an event trigger declares. An email or approval addressed to `requestingUser` goes here.

It is the only place such an address can come from, so a workflow whose trigger declares no requester path cannot mail the requester at all — validation refuses the drawing rather than letting the run discover at send time that it has nobody to write to. `requesterEmailPath` on the trigger, `requestingUser` in the canvas.

`src/ir/catalog.ts:191`

### downstream

The titles of the work a run still has ahead of it at one block, in the order it does that work — what the page a person lands on after answering tells them happens next, drawn as a strip of chips.

Only kinds a person would call work appear: a branch or a loop chooses a way rather than doing anything. An approval's list starts where its arms meet again, so the arm the person did not take never shows up as something they set off — which is why it is worked out once and carried on the wait rather than recomputed. It renders nothing at all when a wait has nothing after it, because a fixed strip of plausible-looking steps would be a lie in every app that copied the runtime.

`src/compile/plan.ts:142`

### artifact

A file in the object store: either one a workflow produced or one somebody uploaded through a form. The app puts objects and hands out links to read them — `/a/<token>` checks the token and redirects to a short-lived signed URL from the store — and never carries the bytes itself.

What a workflow receives for an uploaded file is a descriptor — `{ id, filename, contentType, size }`, where the id is the storage key — never bytes, because what a wake carries is written to the system database. The whole feature is optional: with no store configured the route says it has none and a form renders its dropzone disabled, which is a better answer than a form that takes a file and quietly loses it.

`src/scaffold/app/artifacts.ts:8`
