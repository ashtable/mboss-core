# ADR-0005 — The writer holds the ruler; the emitters decide where to break

**Status** accepted · **Date** 2026-09-06 · **Applies to** `@mboss/core`

## Context

mBoss writes TypeScript into somebody's project that nobody will review line by line, and the promise it makes about that file is that prettier leaves it alone — `src/compile/emit-linear.test.ts:897` and `:959` format every compiled golden and require it back byte for byte, and `src/compile/integration.test.ts:318` runs the generated project's own prettier over everything mBoss wrote. Which shape is right depends on how wide a thing is at the indent it lands on, and only the buffer knows the indent, so it is tempting to let the buffer decide as well as measure. It cannot, because width is not the only thing prettier goes by. It breaks a list whose members are all objects with more than one key however short they are (`src/compile/emit-wait.ts:266`), it breaks prose after a space so the pieces join back to the sentence somebody actually typed (`src/compile/emit-wait.ts:238`), and it keeps an arrow beside its call until the call itself has to break (`src/compile/emit-wait.ts:292`). Each of those is a fact about the value being written, and a buffer that only sees strings has no way to know any of them.

## Decision

`SourceWriter` holds the current indent, how a comment wraps, and that two blank lines in a row are one blank line — the charter at `src/compile/source.ts:1-10`, and the whole of the file's 198 lines. It also carries the code width, but only to answer `fits` (`src/compile/source.ts:146`); it never acts on the answer. Eleven call sites across three emitters ask `fits` and pick the shape themselves — `emit-wait.ts` at 110, 166, 204, 205, 307 and 314, `emit-control.ts` at 265 and 288, `emit-linear.ts` at 362, 821 and 1759 — and a review that proposed moving those decisions behind the writer was refused.

## Consequences

The same three lines — build the one-line form, ask `fits`, otherwise open and close — are written out eleven times, and somebody who wants to change how every call breaks has to touch three files instead of one. An emitter that forgets to ask gets no warning; it just emits a file that stops matching itself the first time anybody formats it, which is why the idempotence tests are the ones that matter. In exchange, `src/compile/source.ts` imports nothing at all and `src/compile/source.test.ts` never mentions a workflow, so the shapes can be tested with a bare writer and a closure (`src/compile/emit-control.test.ts:21-28`). Reversing the split would put the `Emitted` union from `emit-wait.ts` inside a file that `emit-wait.ts` already imports, which is a cycle before it is anything else.

## What holds it

src/compile/emit-wait.test.ts:241 — it formats both prose shapes with prettier and requires the output back unchanged; src/compile/emit-linear.test.ts:897 and :959 do the same for every compiled golden, and src/compile/integration.test.ts:318 for a real scaffolded project. Those hold the outcome. Nothing holds the boundary: there is no import rule in eslint.config.mjs and no test that would fail if SourceWriter grew a second job.

## Evidence

- src/compile/source.ts:1-10
- src/compile/source.ts:12-23
- src/compile/source.ts:136-148
- src/compile/source.ts:158-173
- src/compile/emit-wait.ts:110
- src/compile/emit-wait.ts:166
- src/compile/emit-wait.ts:195-239
- src/compile/emit-wait.ts:204-205
- src/compile/emit-wait.ts:266-279
- src/compile/emit-wait.ts:292-314
- src/compile/emit-control.ts:246-277
- src/compile/emit-control.ts:285-296
- src/compile/emit-linear.ts:362
- src/compile/emit-linear.ts:821
- src/compile/emit-linear.ts:1759
- src/compile/emit-wait.test.ts:241-283
- src/compile/emit-linear.test.ts:897-905
- src/compile/emit-linear.test.ts:959-967
- src/compile/integration.test.ts:318-320
- src/compile/emit-control.test.ts:21-28
- src/compile/source.test.ts:117-127
- src/test-support/style.ts:27-28
