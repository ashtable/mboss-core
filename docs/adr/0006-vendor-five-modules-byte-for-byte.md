# ADR-0006 — Vendor five core modules into the generated app, byte for byte

**Status** accepted · **Date** 2026-09-06 · **Applies to** `@mboss/core`

## Context

A token a generated app mints is read somewhere other than the app. `mintLink` stamps three link kinds, one per `mboss.dev` route — `/u`, `/f`, `/a` (src/signed-links/index.ts:19-22) — and the cloud services alias `@mboss/core/signed-links` directly rather than the package barrel so that resolving it never drags in the rest of this library (src/signed-links/index.ts:7-11, README.md:5-11). A generated project cannot reach that package at all: it declares eight runtime dependencies and `@mboss/core` is not one of them (src/scaffold/templates/package-json.ts:26-35), because `src/scaffold/app/` is not a library the project depends on — it is real source in this repo, type-checked and linted here on every change and copied into the project verbatim as `src/app/` (src/scaffold/files.ts:53-71, asserted byte for byte at src/scaffold/files.test.ts:151-164), which the project's owner then owns outright (src/scaffold/templates/conventions.ts:35-36). So the same HMAC implementation has to exist on both sides of a boundary no import can cross. A copy that drifted would be a form link that verifies in one place and not the other — the app accepting a token the cloud rejects, or the reverse — and nothing about a stale template says that is what went wrong.

## Decision

Five files under `src/scaffold/app/` are byte-identical copies of modules this repository already had: `signed-links.ts` from `src/signed-links/index.ts` (384 lines), and `email/tokens.ts`, `email/html.ts`, `email/message.ts`, `email/markdown.ts` from their namesakes under `src/email/`. Copied, not adapted — they are the only files in the tree that do not open with the "Written by mBoss when this project was created. It is yours now — edit it freely." banner, and `email/shell.ts` is the one file beside them that is adapted instead and says so in its own header (src/scaffold/app/email/shell.ts:20-26). The copied set is closed under import, which is what makes copying viable at all: `signed-links.ts` reaches `node:crypto` and nothing else, `markdown.ts` reaches only `html.ts` and `tokens.ts`, and the other three import nothing.

## Consequences

This buys a generated app that mints and verifies the same tokens the cloud services do, with no dependency on this library and no build step to keep them aligned, and it costs five files that read as plain duplication to anyone who opens the tree without the reason. A change to `src/email/markdown.ts` or `src/signed-links/index.ts` is now a two-file change in one commit — the test goes red on the first half — which is the intended friction, not an accident of tooling. Neither side is excluded from prettier, so both are formatted the same way and the formatter never splits them. The honest gap is the third copy: once written into a project, `src/app/signed-links.ts` belongs to its owner, and nothing in this repository can stop somebody editing it into a version `mboss.dev` will not accept. Anyone who wants to collapse these five into a shared import has to first give the generated project a way to reach `@mboss/core` at all, and that is the decision being made — not the duplication.

## What holds it

src/scaffold/app/vendored.test.ts:41 — a `describe.each` over the five-pair `COPIES` list at :29-35 compares raw bytes rather than behaviour, backed by two import-surface checks at :45-62 that catch somebody editing both files at once. Seven tests, all passing.

## Evidence

- src/scaffold/app/vendored.test.ts:8-24 — the header: five modules copied rather than adapted, "a copy that drifted would be a link that verifies in one place and not the other — a failure nobody would look for in a template"
- src/scaffold/app/vendored.test.ts:29-35 — the five pairs: signed-links.ts, email/tokens.ts, email/html.ts, email/message.ts, email/markdown.ts
- src/scaffold/app/vendored.test.ts:37-43 — the byte comparison
- src/scaffold/app/vendored.test.ts:45-62 — the vendored signed links reach node:crypto and nothing relative
- src/signed-links/index.ts:3-17 — imports nothing but node:crypto; aliased directly by the cloud services
- src/signed-links/index.ts:19-22 — three link kinds, one per mboss.dev route (/u, /f, /a)
- README.md:5-11 — cloud consumers alias @mboss/core/signed-links rather than the package barrel
- src/scaffold/files.ts:53-71 — src/scaffold/app/ is real source here, copied into a project verbatim, and may never be imported from the scaffold
- src/scaffold/files.test.ts:151-164 — the copied runtime is byte-identical to the source this repo type-checks
- src/scaffold/templates/package-json.ts:26-35 — the project's eight runtime dependencies; @mboss/core is not among them
- src/scaffold/templates/conventions.ts:35-36 — "src/app/ is the runtime, and it is yours. mBoss wrote it when the project was created and will not touch it again."
- src/scaffold/app/email/shell.ts:20-26 — "it is the one file in this directory that is not a copy of mBoss's"
- src/scaffold/app/links.ts:4 and src/scaffold/app/routes/form.ts:25 — the app mints and verifies through the vendored copy
- src/import-graph.test.ts:89-104 — the signed-links and email subpaths hold to their declared external surface
- shasum over both trees: 5 of 5 pairs match (fc734b0 signed-links, 73cc1cd tokens, b7d89d5 html, 087186d message, 4bbe9bc markdown); vitest run src/scaffold/app/vendored.test.ts — 7 passed
