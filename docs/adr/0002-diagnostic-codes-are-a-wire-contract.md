# ADR-0002 — Diagnostic codes are a wire contract, not a derived enum

**Status** accepted · **Date** 2026-09-06 · **Applies to** `@mboss/core`

## Context

A diagnostic is product surface, not an internal detail: the code is matched on by the MCP server and the extension, and the message is read by a person looking at a canvas (src/validate/diagnostic.ts:9-14). Sixteen codes are written out by hand in `DiagnosticCodeSchema` (src/validate/diagnostic.ts:23-40), and next door sit sixteen exported rule functions that each emit exactly one code and only their own (src/validate/rules.ts:110-1147) — which makes the enum look like a second copy of the rule list, waiting to be generated away. It is not a copy, because the two have different lifetimes. `DiagnosticSchema` is embedded in `ProposalSchema` (src/apply/proposal.ts:86) and a proposal's findings are stored rather than recomputed on read, so that the preview a person approves is the one the agent was shown (src/apply/proposal.ts:73-79); the codes go to disk in `.proposal.json` (src/apply/paths.ts:32) and a later build parses them back. Callers already read the strings as data, inside this repository and outside it: `canCompile` refuses to compile a document with a `V07` on it (src/validate/index.ts:75), and the apply gate is exercised by matching `V01` (src/apply/gate.test.ts:59).

## Decision

The sixteen codes are a stable contract, declared by hand and never derived from the rules that emit them. A rule whose meaning changes gets a new code rather than widening an old one: V15 rather than a wider V10, because V10 names a wire and V15 names two blocks with a stretch of workflow between them (src/validate/rules.ts:1058-1062), and V16 rather than a wider V13, because V13 is about what a signature declares and V16 about what the body does (4a96ee0). `RULES` stays a hand-kept ordered list for the same family of reasons — the order it is written in is the order findings come back in (src/validate/index.ts:41), so a document with several problems reports them the same way every time.

## Consequences

The cost is three hand-kept lists — the enum, the severity table, the rule array — that have to be edited together, and the type system holds only two of the three joins. Leaving a code out of `RULE_SEVERITY` is TS2741 and taking a code out of the enum is TS2353 at that same table plus TS2345 at the rule that emits it; both were checked by deleting `V16` from each place and running `tsc --noEmit`. Nothing holds a code to its meaning — that is the new-code-rather-than-reused-code habit, and it lives in review and in commit messages, not in a check. Retiring a code is worse than it looks: an outstanding `.proposal.json` carrying it fails `safeParse`, comes back as `undefined`, and the apply path reports `PROPOSAL_NOT_FOUND` (src/apply/proposal.ts:236-238, src/apply/index.ts:248-249) — the proposal does not fail loudly, it stops existing. Deriving either list from the other would delete one hand-kept file and buy nothing: a derived enum shrinks whenever a rule is deleted, which is exactly the code an old proposal file still needs parsed, and a derived list has no order.

## What holds it

src/validate/diagnostic.ts:84 — `RULE_SEVERITY` is a total `Record<DiagnosticCode, DiagnosticSeverity>`, so a missing key is TS2741 and a retired code is TS2353 there plus TS2345 at its emitting rule (both verified by probe) — together with src/validate/rules.test.ts:1543, "runs every rule this module exports", which finds the rules by name and asserts each is in `RULES` and that `RULES` is no longer than that set. Nothing enforces that a code keeps its meaning across releases, and nothing pins the enum's contents against an older build's `.proposal.json`.

## Evidence

- src/validate/diagnostic.ts:9-14 — a diagnostic is product surface; the code is matched on by the MCP server and the extension
- src/validate/diagnostic.ts:17-22 — codes are stable across releases because tools key off them; a rule that changes meaning gets a new code
- src/validate/diagnostic.ts:23-40 — DiagnosticCodeSchema, sixteen entries V01..V16 (counted)
- src/validate/diagnostic.ts:84-101 — RULE_SEVERITY: Record<DiagnosticCode, DiagnosticSeverity>, sixteen keys, two of them warnings (V03, V07)
- src/validate/diagnostic.ts:112 — SoftCode = 'V01' | 'V03' | 'V07', the narrow door to the warning constructor
- src/validate/index.ts:41 — validateWorkflow is RULES.flatMap, so list order is finding order
- src/validate/index.ts:75 — canCompile keys off the literal 'V07'
- src/validate/rules.ts:35-41 — RULES is the list validateWorkflow walks; being written in the file is not being on it, and a test holds the two together
- src/validate/rules.ts:1038-1043 — orphaned comment, 'Every rule, in code order'
- src/validate/rules.ts:1058-1062 — a separate rule rather than a wider V10, because the codes are what tools match on
- src/validate/rules.ts:1184-1201 — RULES, sixteen entries, v15GuardedProducers eleventh (counted)
- src/validate/rules.ts:110,163,229,257,282,351,436,489,591,642,687,748,828,915,1064,1125 — sixteen exported rule functions, each emitting only its own code (counted)
- src/validate/rules.test.ts:1534-1541 — the last four rules, the ones that read the scan, in order
- src/validate/rules.test.ts:1543-1574 — every exported rule is in RULES, and RULES holds nothing twice
- src/apply/proposal.ts:73-79 — diagnostics stored rather than recomputed, so the preview approved is the one shown
- src/apply/proposal.ts:80-90 — ProposalSchema embeds DiagnosticSchema
- src/apply/proposal.ts:236-238 — parseProposal returns undefined when the file does not parse
- src/apply/index.ts:197-220 — proposeSpec writes the findings into the proposal
- src/apply/index.ts:201-202 — a spec with any error is refused before anything is written
- src/apply/index.ts:248-249 — an unparseable proposal is reported as PROPOSAL_NOT_FOUND
- src/apply/paths.ts:32 — PROPOSAL_SUFFIX = '.proposal.json'
- src/apply/gate.test.ts:59 — a caller matching the literal 'V01' through the apply path
- src/scaffold/templates/dotfiles.ts:34 — .mboss/proposals/ is gitignored in a scaffolded project
- src/index.ts:3 — the validate surface, DiagnosticCodeSchema included, is re-exported to consumers
- 92d98ee — the list stays hand-kept; deriving it was looked at and turned down
- 4a96ee0 — V16 rather than a wider V13: tools match on these codes
- 5f9ed02 — V15 rather than a wider V10, and the commit that orphaned the RULES comment
