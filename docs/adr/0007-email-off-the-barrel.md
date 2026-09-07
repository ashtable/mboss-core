# ADR-0007 — Keep email out of the barrel and hold both subpaths to leaves

**Status** accepted · **Date** 2026-09-06 · **Applies to** `@mboss/core`

## Context

This package is consumed as source: `main` and `types` are both `src/index.ts` (package.json:11-12) and `files` ships the whole `src` tree (package.json:13-15), so whatever entry a consumer names it has to resolve, and everything that entry can reach lands in its type graph and its bundle. The rest of the library reaches for ELK, ts-morph, `node:fs`, and a scaffold tree that ships express, the DBOS SDK and a Prisma client. Two directories are wanted by consumers that can afford none of that: the admin console renders the waitlist confirmation and the broadcast live in a browser as an author composes them (src/email/index.ts:7-17), where a single `node:` builtin breaks the bundle, and the cloud services verify `mboss.dev/u/<token>` links with nothing but `node:crypto` (src/signed-links/index.ts:1-11).

## Decision

`src/index.ts` is the one barrel and re-exports ten subsystems, `signed-links` among them (src/index.ts:1-10). `src/email` is the one shipped directory deliberately left off it — a consumer aliases the directory as `@mboss/core/email`, the way it also aliases `@mboss/core/signed-links` rather than paying for the barrel (README.md:9-10, README.md:28-31). Both directories are then held to a written-out list of what their entry graph may import — `[]` for email, `['node:crypto']` for signed-links — so that the alias keeps costing nothing (src/import-graph.test.ts:89-111).

## Consequences

The empty list is a real constraint on the templates rather than a tidy one: `listUnsubscribeHeaders` had to move into `src/email` rather than stay shared with the worker, and since the directory may not have `node:crypto` either, a generated project carries byte-identical copies of `signed-links.ts` and four email leaves, held to their originals by src/scaffold/app/vendored.test.ts:29-42 — a copy that drifted would be a link that verifies in one place and not the other. What nothing here catches is the barrel itself: adding `export * from './email/index.js'` to src/index.ts would pass every test and `tsc --noEmit`, and the breakage would surface as a broken bundle in the console's repo. The rule keeping consumers off the barrel also lives in each of those repos as ESLint config (README.md:29-31), and package.json declares no `exports` map, so `@mboss/core/email` is an alias each consumer configures — a future reader tempted to replace the aliases with an `exports` field should know they exist because this package ships TypeScript source rather than a build.

## What holds it

src/import-graph.test.ts:89-111

## Evidence

- package.json:11-12 — main and types are both src/index.ts
- package.json:13-15 — files ships the whole src tree; verified there is no `exports` field
- package.json:22 — lint runs `tsc --noEmit && eslint . && prettier --check .`
- src/index.ts:1 — the barrel re-exports ./signed-links/index.js
- src/index.ts:1-10 — ten `export *` lines; none of them is ./email/index.js
- src/import-graph.test.ts:76-92 — the SUBPATHS table and its reason: email's empty surface is load-bearing because the console renders the templates in a browser
- src/import-graph.test.ts:89-92 — signed-links declares ['node:crypto'], email declares []
- src/import-graph.test.ts:94-111 — three assertions per subpath: declared external surface, no relative escape from the directory, and a non-vacuity check that the entry was actually visited
- src/import-graph.test.ts:113-160 — the scaffold never imports its app/ or workflows/ tree and keeps express, pg, dotenv, the DBOS SDK and Prisma out of its own surface
- src/import-graph.test.ts:162-189 — src/ir/edit.ts reaches only zod and never leaves ir/
- src/import-graph.test.ts:191-215 — src/validate/handler-fit.ts reaches only zod, and provably as far as manifest/types.ts
- src/import-graph.test.ts:217-255 — src/compile parses with ts-morph's bundled compiler, not the typescript devDependency, and imports none of the packages it emits imports of
- src/import-graph.test.ts:257-278 — src/compile/names.ts imports nothing at all
- src/import-graph.test.ts:280-386 — src/patterns makes no filesystem read at import and never imports the handler sources it copies
- src/import-graph.test.ts:34-74 — walk() follows relative imports only, records external specifiers, and throws on an unresolvable relative import so a failed walk cannot read as a clean graph
- src/email/index.ts:14-17 — the module header states the directory imports nothing at all, not even a node: builtin, and that a test enforces it
- src/signed-links/index.ts:1 — the sole import is node:crypto
- src/signed-links/index.ts:7-11 — the header states the cloud services alias it directly so resolving it never drags in the rest of the library
- src/scaffold/index.ts:1-20 — the runtime tree is read with readFileSync so express, the DBOS SDK and Prisma stay out of the import graph
- src/scaffold/app/vendored.test.ts:29-42 — the five byte-identical copies: signed-links/index.ts and email/{tokens,html,message,markdown}.ts
- src/scaffold/app/vendored.test.ts:44-64 — the vendored signed-links copy is separately asserted to reach node:crypto and nothing relative
- src/test-support/specifiers.ts:28-65 — specifiersOf uses the compiler's parser and covers static, type-only, `export … from`, dynamic import() and require()
- src/index.test-d.ts:1-15 — the compile-time barrel contract; tsc --noEmit is the assertion
- README.md:9-10 — consumers alias @mboss/core/signed-links rather than the barrel
- README.md:27-31 — email imports nothing at all, is the one shipped module kept out of the barrel, and consumers are barred from the barrel by an ESLint rule in each of their own repos
- eslint.config.mjs:1-21 — this repo's ESLint config has no import restriction; the barrel ban is not here
- Verified by running: `vitest run src/import-graph.test.ts` — 8 describe blocks, 16 tests, all passing
