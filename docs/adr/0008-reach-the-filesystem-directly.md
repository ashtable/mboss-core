# ADR-0008 — Reach the filesystem directly, and test on a real one

**Status** accepted · **Date** 2026-09-06 · **Applies to** `@mboss/core`

## Context

Almost everything src/apply/ promises is a promise the filesystem makes, not one this code makes. The mutual exclusion in the write lock is `open(path, 'wx')` failing with EEXIST and nothing else (src/apply/lock.ts:102); the guarantee that no reader ever sees half a workflow document is that a rename is one step (src/apply/atomic-write.ts:75); a holder that died is detected by the lock file's mtime (src/apply/lock.ts:167). The writers are separate processes — an editor, an MCP server, a build (src/apply/lock.ts:23-26) — so a fake living inside one process cannot even express the thing being excluded. Put those behind a fake and the fake has to reimplement them, and the tests then assert the reimplementation: "locks, renames and directory listings are the behaviour under test, and a mocked filesystem would be asserting the mock" (src/test-support/project.ts:11-14).

## Decision

Five modules in src/apply/ import node:fs and call it — atomic-write, history, index, lock and proposal — with no indirection in between. Tests that need a project get a real directory outside the repo and delete it afterwards (src/test-support/project.ts:24-39); the two that need only a bare directory call mkdtemp themselves, because the lock is about mutual exclusion and not about workflows (src/apply/lock.test.ts:32-42). The one moment a real filesystem cannot be asked about from outside — between writing the temp sibling and renaming it over the destination — is exposed by the writer itself as a `beforeRename` hook (src/apply/atomic-write.ts:48, awaited at :74), so a test can read the destination, read the temp file and count the directory's entries while the write is half done.

## Consequences

It costs a hook in shipping code whose only two callers are tests, and a test that dies mid-run leaves a directory behind in tmpdir. Behaviour is whatever the host OS does, and CI only ever runs ubuntu-latest (.github/workflows/ci.yml:5), so renaming over an existing file — which Windows refuses outright — is exercised nowhere but a developer's machine. What it buys is that a broken guarantee breaks a test rather than a fake quietly drifting: the mid-write assertions, and the check that the temp sibling is never created more openly than asked, which is what keeps the scaffold's `.env` at 0600 from the moment it exists (src/scaffold/files.ts:223, src/scaffold/scaffold.ts:74, src/scaffold/templates/env.ts:47). The usual reason to reach for a fake does not apply here — the whole src/apply/ suite, 8 files and 61 tests against real directories, runs in 449ms.

## What holds it

src/apply/atomic-write.test.ts:31 — at the instant between the two steps it reads the destination, reads the temp sibling, checks the temp file's directory and counts the entries, expecting 'old', 'new', the destination's own directory, and 2; nothing but a real filesystem satisfies that, and nothing else in the repo would notice if the rename stopped being atomic. The direct-fs half is enforced by nothing: eslint.config.mjs:9-20 carries one rule and it is about unused parameters, so no lint rule stops a future module introducing a fake.

## Evidence

- src/test-support/project.ts:7-16 — the argument, verbatim: a mocked filesystem would be asserting the mock
- src/test-support/project.ts:24-39 — makeProject/removeProject: mkdtemp under tmpdir, rm recursive afterwards
- src/apply/atomic-write.ts:41-48 — beforeRename declared, described as observing the instant between the two steps
- src/apply/atomic-write.ts:64-75 — temp sibling in the destination's directory, writeFile, hook, rename
- src/apply/atomic-write.test.ts:31-50 — the mid-write observation; asserts destination 'old', temp 'new', tempDir === dir, 2 entries
- src/apply/atomic-write.test.ts:52-71 — temp sibling mode 0o600 checked through the same hook
- src/apply/lock.ts:23-26 — a file rather than an in-process mutex because the writers are separate processes
- src/apply/lock.ts:102 — open(path, 'wx') is the whole mechanism
- src/apply/lock.ts:167 — staleness decided by the lock file's real mtimeMs
- src/apply/lock.test.ts:109-128 — stale takeover driven by utimes on a real lock file
- src/apply/lock.test.ts:32-42 — mkdtemp directly, no .mboss/ needed
- src/apply/history.ts:144 and src/apply/proposal.ts:185 — the directory listings named in the argument
- src/apply/index.ts:1-2, src/apply/history.ts:1-2, src/apply/lock.ts:2, src/apply/proposal.ts:2, src/apply/atomic-write.ts:2 — the five non-test modules in src/apply/ importing node:fs (count made by grep)
- src/compile/smoke.test.ts:94 — the only vi.mock in src/, and it mocks @dbos-inc/dbos-sdk, not the filesystem; no memfs or mock-fs anywhere
- eslint.config.mjs:9-20 — no no-restricted-imports rule
- vitest.config.ts:4 — environment 'node', no fs setup or shim
- .github/workflows/ci.yml:5 — runs-on: ubuntu-latest, the only OS
- src/scaffold/scaffold.ts:74 and src/scaffold/files.ts:223 and src/scaffold/templates/env.ts:47 — the scaffold's .env goes through writeFileAtomic at ENV_MODE = 0o600
- npx vitest run src/apply/ — 8 files, 61 tests, all passing, 449ms (measured)
