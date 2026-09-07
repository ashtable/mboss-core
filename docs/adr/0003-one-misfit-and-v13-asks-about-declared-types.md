# ADR-0003 — Answer with one misfit, and let V13 ask only about declared types

**Status** accepted · **Date** 2026-09-06 · **Applies to** `@mboss/core`

## Context

Three surfaces ask whether a function from the project's code-behind can sit behind a block: the picker in the Inspector greys a row with a short note, the drop target on a node refuses a drop with a notification, and validation writes a diagnostic. A function the picker offers and the drop target refuses is a bug a person has no way to explain, so there is one implementation of the question and it answers with a code rather than a sentence — each surface writes its own (src/validate/handler-fit.ts:8-33). Each of them shows one sentence, so the answer is the first thing wrong and not a list of everything wrong; the order is chosen so the first thing named is the first thing to fix, which is why a transaction that calls out is reported ahead of anything about its signature (src/validate/handler-fit.ts:129-179). But validation cannot report all six of the misfits it can be told about: `optional` is a field a manifest an older build cached may not carry, and `.mboss/manifest.json` is keyed on the sources' hash rather than on the build that wrote it, so counting what a call cannot leave out could put an error on a handler that compiles (src/manifest/types.ts:46-64). Asking the whole question and then reporting only two of its answers let a reason V13 stays quiet about hide one it will give: a step declaring an `out` its handler does not return went unreported by anybody whenever that handler also took two values — `validateWorkflow` came back empty, `canCompile` said yes (src/validate/index.ts:66-77), and the file was emitted (commit 81fb571).

## Decision

`handlerFit` answers with one misfit — the first thing wrong, in a fixed order — and that stays exactly what the picker and the drop target are handed; it is the only form of the question on the package surface (src/validate/index.ts:84,91). V13 no longer asks it. The tail of `misfitOf` is named `declaredTypeMisfit` and the rule asks that instead (src/validate/handler-fit.ts:202-243, src/validate/rules.ts:851), so it reports the two misfits about types somebody wrote down and nothing that comes earlier can hide them. The silence about arity is kept, and so is its reason: neither type comparison reads `optional`, which is why this half can be reported when the other half cannot.

## Consequences

There is still one comparison with two questions asked of it, which is the whole point of the file — but a reader now has to know which question a caller wants, and a rule that asks the wider one silently inherits the ordering. V16 still asks `handlerFit` and reads only `external-call` (src/validate/rules.ts:1143-1144); that is safe only because a transaction's outward call is asked first, so a new misfit inserted above it would silence V16 the way arity silenced V13. The arity silence costs something real: a handler with two required parameters is refused at the picker, at the drop target and by the generated project's own type-check, but never by `validateWorkflow` — someone driving the IR through the MCP server rather than the canvas hears nothing until compile. A future reader will reasonably want V13 to say it too; the price is that the finding would be read off a cache that may have recorded nothing about which parameters a call can leave out, and would put an error on a handler that compiles.

## What holds it

src/validate/rules.test.ts:1103 ("reports a wrong return type the arity used to hide") holds the fix, and src/validate/rules.test.ts:1058 holds the arity silence beside it with a node whose types match, so it cannot pass for the wrong reason. The type enforces it as well: `mismatchMessage` takes `DeclaredTypeMisfit` (src/validate/rules.ts:869), so changing V13 back to `handlerFit` is a `tsc --noEmit` failure under `npm run lint` — I checked, and it reports TS2345, 'HandlerMisfit is not assignable to DeclaredTypeMisfit'. The one-reason shape itself is held by the singular `reason` field of `HandlerFit` (src/validate/handler-fit.ts:56-57), pinned on the package surface at src/index.test-d.ts:139-140, and by the ordering tests at src/validate/handler-fit.test.ts:247 and :268.

## Evidence

- src/validate/handler-fit.ts:8-22
- src/validate/handler-fit.ts:24-33
- src/validate/handler-fit.ts:34-54
- src/validate/handler-fit.ts:56-57
- src/validate/handler-fit.ts:64-67
- src/validate/handler-fit.ts:115-119
- src/validate/handler-fit.ts:121-128
- src/validate/handler-fit.ts:129-179
- src/validate/handler-fit.ts:181-201
- src/validate/handler-fit.ts:202-243
- src/validate/rules.ts:794-826
- src/validate/rules.ts:843-858
- src/validate/rules.ts:866-886
- src/validate/rules.ts:1140-1144
- src/validate/index.ts:66-77
- src/validate/index.ts:84
- src/validate/index.ts:91
- src/manifest/types.ts:46-54
- src/manifest/types.ts:58-65
- src/validate/rules.test.ts:1058-1078
- src/validate/rules.test.ts:1080-1101
- src/validate/rules.test.ts:1103-1131
- src/validate/handler-fit.test.ts:247-266
- src/validate/handler-fit.test.ts:268-289
- src/validate/handler-fit.test.ts:353-372
- src/index.test-d.ts:27
- src/index.test-d.ts:139-140
- src/import-graph.test.ts:191-215
- package.json:22
