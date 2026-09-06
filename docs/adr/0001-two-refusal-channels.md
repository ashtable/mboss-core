# ADR-0001 — Keep the compiler's refusals out of the validation rules

**Status** accepted · **Date** 2026-09-06 · **Applies to** `@mboss/core`

## Context

Validation is the one question the canvas, the MCP server and the compiler all ask, so that an agent and a person get the same answer about the same file (src/validate/index.ts:7-19). Its answers are a wire contract: codes V01 through V16 are matched on by tools and stay stable across releases, and a rule that changes meaning gets a new code rather than reusing one (src/validate/diagnostic.ts:17-22). It also has to run where no project has been scanned, which limits it to what a document can be checked against on its own. The compiler answers a different question — whether this compiler, today, can write TypeScript for the shape somebody drew — and most of those answers only exist once the plan has been built, because the plan is what says the order blocks run in and whose value each one reads (src/compile/plan.ts:20-38). Asking them inside a validation rule would mean a second walk of the graph that has to agree with the emitter's, which is the disagreement the planner was built to prevent.

## Decision

Two refusal channels, not one. `validateWorkflow` and `canCompile` say what is invalid and come back as diagnostics (src/compile/compile.ts:68-70); `UnsupportedIR` (src/compile/unsupported.ts:22) says what is a legal draft this compiler cannot turn into code, and is thrown from 26 places, caught once at `compileWorkflow` (src/compile/compile.ts:79), and returned as the `UNSUPPORTED` result. The boundary is policed in both directions: the compiler holds no second opinion about what is legal, because a compiler that disagrees with the canvas somebody drew is worse than one that refuses (src/compile/compile.ts:32-38), and a refusal validation already gives is not repeated here — commit 9f2e8f6 deleted four planner refusals for saying `UnsupportedIR` about documents `canCompile` had already turned down.

## Consequences

It costs a person a second shape of refusal for what looks like one question, and the sentence is all they get: there is no code for the canvas to key off, translate, or hang a quick fix on, so the remedy has to be written into the message itself (src/compile/plan.ts:345-349). It buys refusals that can disappear as the compiler grows — a limit named in a sentence goes away when the emitter learns the shape, where a V-code, once tools match on it, is kept forever. It also buys a planner whose whole import graph is `ir/` and `zod`, which is what lets the extension bundle it: when `#checkWaysInAgree` needed to know whether a handler takes a value, the answer was handed in as `readsValue` rather than the planner reaching for the manifest (src/compile/plan.ts:225-234, commit e04b206 today). What it makes harder is knowing where a new check belongs — nothing computes the boundary, so it is argued one check at a time; and because `planWorkflow` is exported (src/compile/index.ts:38), a caller who plans without compiling gets the exception rather than a result, which is why the class is exported beside it (src/compile/index.ts:59).

## What holds it

src/compile/plan.test.ts:61 — `refusal()` fails with "planned without refusing it" unless `planWorkflow` itself throws `UnsupportedIR`, and six planner refusals run through it, so moving any of them into a rule turns that test red rather than quietly green. Held up on the other side by src/compile/compile.test.ts:61 and :106, where "the compile gate" asserts `CANNOT_COMPILE` and "what the compiler cannot emit yet" asserts `UNSUPPORTED` for a document validation finds clean; by src/patterns/refund-approval.test.ts:481, which rejects any result that is not `UNSUPPORTED`; and by the `CompileResult` type itself (src/compile/compile.ts:51-54), whose two false branches carry different payloads — `diagnostics` against `nodeId`/`message` — so a caller cannot collapse one into the other. Nothing enforces the narrower claim at src/compile/unsupported.ts:16-20 that only this class is caught: the `instanceof` guard at src/compile/compile.ts:79 is the whole of it, and no test asserts that a `TypeError` out of an emitter still escapes.

## Evidence

- src/compile/unsupported.ts:1-21 — the class header: an exception rather than a result type on every emitter, because emission is a tree walk a dozen functions deep
- src/compile/unsupported.ts:16-20 — only this class is caught; a TypeError out of the compiler is a compiler bug
- src/compile/compile.ts:29-39 — "The gate is validation's, not this module's"
- src/compile/compile.ts:51-54 — CompileResult: ok, CANNOT_COMPILE with diagnostics, UNSUPPORTED with nodeId and message
- src/compile/compile.ts:63-88 — validate first, then emit inside the one try; :79 is the sole catch
- src/validate/index.ts:7-19 — validation is what the canvas, the MCP server and the compiler all ask
- src/validate/index.ts:54-77 — canCompile is stricter than the edit gate, in exactly two places
- src/validate/diagnostic.ts:17-22 — codes are stable across releases because tools key off them
- src/compile/plan.ts:20-38 — answering order and value-source while writing is how codegen comes to differ from what validation checked
- src/compile/plan.ts:320-377 — #checkWaysInAgree, the refusal reaffirmed today, and why its message carries its own remedy
- src/compile/plan.ts:225-234, 279-283 — readsValue passed in so the planner never imports the manifest
- src/compile/replay.ts:571-581 — the one UnsupportedIR that is not about the drawing
- src/compile/index.ts:38, :59 — planWorkflow and UnsupportedIR are both public, so the exception is part of the API
- src/compile/compile.test.ts:61, :106 — the two channels tested as two describes, side by side
- src/compile/plan.test.ts:50-69 — the planner's refusals asked of the planner
- src/patterns/refund-approval.test.ts:471-486 — refusalFor insists on UNSUPPORTED, not CANNOT_COMPILE
- src/validate/rules.ts:22-40 and src/validate/rules.test.ts:1568,1573 — the rule list is closed and a test holds it to the rules the module exports
- commit 9f2e8f6 — "UnsupportedIR means 'a legal draft this compiler cannot emit yet'"; four refusals deleted for straying across the line
- commit e04b206 (today) — the ways-in check widened inside the planner rather than moved into a rule
