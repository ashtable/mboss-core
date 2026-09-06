# ADR-0004 — Hand the planner the answer, not the manifest

**Status** accepted · **Date** 2026-09-06 · **Applies to** `@mboss/core`

## Context

`#checkWaysInAgree` — the check that every way into a block arrives carrying the same value (src/compile/plan.ts:351) — used to run only where the document declared an `in`. That is the wrong thing to ask. A handler takes what its signature says whatever the block claims about itself, so a drawing with `in` left off slipped the check and compiled to a file that bound one arm's value and then named it nowhere. The right question is what the scan says the handler takes, and the answer to it lives in `consumesValue` (src/validate/handler-fit.ts:111). But the planner has no scan and must not acquire one: `src/compile/plan.ts` reaches ten files and one external package, `zod`, and the extension bundles it into a webview. The emitter reads `consumesValue` through the validate barrel (src/compile/emit-linear.ts:15), and that barrel's graph is eighteen files carrying `ts-morph`, `node:fs`, `node:crypto`, `node:module` and `node:path` behind it — `manifest/scan.ts` and everything under it. A planner that imported what the emitter imports would stop being bundleable, and the canvas would stop being able to plan.

## Decision

`PlanOptions` carries `readsValue`, a predicate over a node, rather than a `LibManifest` (src/compile/plan.ts:225). The planner is handed the answer, not the means to it, so its import graph does not move. The emitter passes one built from its own manifest lookup, being the first place that holds both the document and the scan (src/compile/emit-linear.ts:204); `traceGrammar`, which has no scan, passes nothing and falls back to `declaresInput` — what the document says about itself (src/compile/plan.ts:212, src/compile/replay.ts:409).

## Consequences

Two callers of the same function now ask different questions of the same drawing. The check only ever returns or throws (src/compile/plan.ts:351-377), so the plan itself is identical either way — but `traceGrammar` will happily build a grammar for a document the compiler refuses to emit, and a reader who trusts the grammar as a statement about what will compile is wrong. The predicate is a closure over `#functionFor` (src/compile/emit-linear.ts:978), so the one place that knows how a node finds its function stays inside the emitter; a third caller wanting this gate has to write that lookup again or borrow the emitter's. A future reader will reasonably want to put `LibManifest` on `PlanOptions` and let the planner do the lookup once — and importing `handler-fit.ts` directly rather than through the barrel would in fact keep the graph at `zod`, so the bundling argument alone does not forbid it. What forbids it is that it hands the planner a manifest it has no other use for, to answer one question somebody else has already answered.

## What holds it

The type is what holds the shape: src/compile/plan.ts:225-227 declares `readsValue?: (node: WorkflowNode) => boolean`, so no caller can hand the planner a manifest, and src/index.test-d.ts:233 pins that a caller with no scan can still plan. The behaviour is pinned at src/patterns/refund-approval.test.ts:279-287, which asserts the refusal is byte-identical whether or not the block declares what it reads. Nothing enforces the import graph: the seven blocks in src/import-graph.test.ts walk signed-links, email, scaffold, ir/edit.ts, validate/handler-fit.ts, compile/index.ts, compile/names.ts and patterns, and the compiler block (src/import-graph.test.ts:230) asserts `ts-morph` _is_ external — so plan.ts could import the validate barrel tomorrow and every test would pass.

## Evidence

- src/compile/plan.ts:202-214 — `declaresInput`, the fallback, with its own note that it is the wrong question and the right one needs a scan the planner cannot reach
- src/compile/plan.ts:216-227 — the `PlanOptions` comment and the `readsValue?: (node: WorkflowNode) => boolean` field
- src/compile/plan.ts:229-234 — `planWorkflow` defaulting to `declaresInput`
- src/compile/plan.ts:280-282 — the gate: `if (this.#readsValue(node))` before `#checkWaysInAgree`
- src/compile/plan.ts:351-377 — `#checkWaysInAgree` returns void: it returns early or throws `UnsupportedIR`, and mutates nothing
- src/compile/emit-linear.ts:15 — `import { consumesValue } from '../validate/index.js'`
- src/compile/emit-linear.ts:197-206 — the constructor sets `#manifest` at 199, then plans at 204 passing `readsValue: (node) => consumesValue(this.#functionFor(node))`
- src/compile/emit-linear.ts:978-986 — `#functionFor`, the manifest lookup the predicate closes over
- src/compile/replay.ts:409 — `traceGrammar` calls `planWorkflow(ir)` with no options
- src/validate/handler-fit.ts:99-113 — `consumesValue`, counted over every parameter rather than the required ones
- src/validate/index.ts:84 — the barrel that re-exports `consumesValue`
- src/compile/index.ts:44 — `PlanOptions` is exported from the compiler's surface
- src/index.test-d.ts:233 — `const emission: EmissionPlan = planWorkflow(ir);` with no second argument
- src/patterns/refund-approval.test.ts:262-287 — the shape with `in` left off is refused, and refused identically to the shape that declares it
- src/patterns/refund-approval.test.ts:478-488 — `refusalFor` runs the real compile, so the emitter's predicate is what produces the refusal
- src/import-graph.test.ts:94,125,175,202,230,267,355 — the seven import-graph blocks; none walks src/compile/plan.ts
- Measured with a walk of relative imports from src/compile/plan.ts: 10 files reached (plan.ts, compile/unsupported.ts, and the eight files of ir/), external specifiers exactly ['zod']
- Measured the same way from src/validate/index.ts: 18 files reached, external specifiers ['node:crypto','node:fs','node:module','node:path','ts-morph','zod']
