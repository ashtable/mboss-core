/**
 * Compile-time contract for the package surface.
 * `tsc --noEmit` (part of `npm run lint`) is the
 * assertion: a name that stops reaching the barrel
 * fails the build here, in the repository that
 * owns it, rather than in whichever one pinned it.
 *
 * `main` and `types` are `src/index.ts`, so a
 * consumer imports exactly what this file does.
 * Named imports rather than a namespace, because
 * that is what a consumer writes: a name that stops
 * being exported is a member that is not there, and
 * a namespace import would go on type-checking
 * without it.
 *
 * Not for collisions. Two subsystems exporting one
 * name through `export *` is `TS2308` at the second
 * star in `src/index.ts` — for a value, for a type,
 * and through a nested barrel — so the build
 * already refuses it and says where. This file is
 * for the other direction: a name that quietly
 * stops reaching the surface at all.
 */
import * as core from './index.js';
import {
  CONTAINER_APP_DIR,
  DEFAULT_RETRY,
  NODE_HEIGHT,
  PositionSchema,
  SDK_OPERATIONS,
  blankSpec,
  carryPositions,
  decisionValues,
  deleteNode,
  handlerFit,
  listPatterns,
  matchTrace,
  nextEdgeId,
  ownerOf,
  patternNamed,
  patternSpec,
  place,
  planWorkflow,
  recordedNameLiterals,
  renameNode,
  replayBoundaries,
  starterId,
  starterNode,
  traceGrammar,
  usePattern,
  withDecisionCases,
  withoutPositions,
} from './index.js';

import type {
  EmissionPlan,
  ExternalCall,
  HandlerFit,
  HandlerMisfit,
  LibFunction,
  NodeBox,
  Owner,
  Position,
  RecordedRow,
  RecordedSegment,
  ReplayBoundary,
  Retry,
  TraceGrammar,
  TraceMatch,
  Unoffered,
  UsePatternOutcome,
  WorkflowIR,
  WorkflowNode,
  WorkflowPattern,
} from './index.js';

const branch: Extract<WorkflowNode, { kind: 'branch' }> = {
  id: 'auto_approve',
  kind: 'branch',
  title: 'Approve it?',
  handler: { export: 'autoApprove' },
  config: {
    cases: [
      {
        port: 'yes',
        when: { path: '', op: 'eq', value: true },
        maxIterations: 10,
        onExhausted: 'abort',
      },
    ],
    elsePort: 'else',
  },
};

const ir: WorkflowIR = {
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 4,
  name: 'expense_approval',
  title: 'Expense approval',
  nodes: [
    {
      id: 'claim_filed',
      kind: 'trigger',
      title: 'Claim filed',
      config: { mode: 'manual' },
      out: 'Claim',
      position: { x: 120, y: 80 },
    },
    branch,
  ],
  edges: [
    {
      id: 'e1',
      from: { node: 'claim_filed', port: 'out' },
      to: { node: 'auto_approve' },
      type: 'Claim',
      back: false,
    },
  ],
};

const autoApprove: LibFunction = {
  export: 'autoApprove',
  file: 'lib/expense.ts',
  line: 12,
  params: [{ name: 'claim', type: 'Claim', optional: false }],
  returnType: 'boolean',
  decision: [true, false],
};
// Where a surface opens the file at when somebody
// asks to see the handler. Read back as well as
// written, because a field only ever written to a
// literal can be dropped from the schema without
// anything here noticing.
const declaredAt: number | undefined = autoApprove.line;

// What the canvas draws with: a box per node, from
// the positions the document carries.
const boxes: Promise<Map<string, NodeBox>> = place(ir);
const nodeHeight: number = NODE_HEIGHT;
const position: Position = PositionSchema.parse({ x: 240, y: 120 });

// What the picker, the drop target and validation
// all ask, and the sentence each writes from the
// answer.
const fit: HandlerFit = handlerFit(branch, autoApprove);
const reason: HandlerMisfit | undefined = fit.fits ? undefined : fit.reason;

// A call the scan found in a handler's body, and
// the refusal a surface writes its own sentence
// out of. Both are on the surface because the
// extension greys a row and refuses a drop from
// them, without core writing either sentence.
const charge: ExternalCall = {
  callee: 'fetch',
  via: 'globalThis',
  line: 12,
};
const calledOut: Extract<HandlerMisfit, { kind: 'external-call' }> = {
  kind: 'external-call',
  ...charge,
  file: 'lib/chargeCard.ts',
};
// The refusal carries the whole call and not a
// copy of some of it: a spread pins nothing, since
// a field the scan starts recording would arrive
// through it and go unnoticed. Read back the other
// way it has to be there.
const wholeCall: ExternalCall = calledOut;
const answers: readonly (string | boolean)[] | undefined =
  decisionValues(autoApprove);

// The graph edits, each returning the document
// shape it was handed.
const decided: Extract<WorkflowNode, { kind: 'branch' }> = withDecisionCases(
  branch,
  answers ?? [],
);
const dropped: WorkflowNode = starterNode(
  'step',
  starterId(ir, 'step'),
  'Step',
);
const carried: WorkflowIR = carryPositions(ir, ir);
const bare: WorkflowIR = withoutPositions(ir);
const edgeId: string = nextEdgeId(ir.edges);

const renamed = renameNode(ir, { nodeId: 'auto_approve', newTitle: 'Decide' });
const afterRename: WorkflowIR | undefined = renamed.ok ? renamed.ir : undefined;

const deleted = deleteNode(ir, { nodeId: 'auto_approve', reconnect: true });
const afterDelete: WorkflowIR | undefined = deleted.ok ? deleted.ir : undefined;

// The gallery: what it offers, what using one
// comes to, and the two specs a surface writes
// without a pattern at all.
const gallery: readonly WorkflowPattern[] = listPatterns();
const hero: WorkflowPattern | undefined = patternNamed('refund_approval');
const used: Promise<UsePatternOutcome> | undefined =
  hero && usePattern('/tmp/project', { pattern: hero, name: 'refunds' });
const fromDocument = patternSpec(ir);
const fromNothing = blankSpec('refunds');

// Three values another surface has to read the
// same way core wrote them: the retry policy a
// step gets when the document names none, the
// directory a running container holds the project
// at, and the names the SDK keeps for itself.
// Each was a private constant somewhere until a
// second reader needed it, and a copy would drift
// without anything going red.
const retry: Retry = DEFAULT_RETRY;
const appDir: string = CONTAINER_APP_DIR;
const sdkOwned: boolean = SDK_OPERATIONS.has('DBOS.sleep');

// Reading a recording back to the drawing it came
// from. `ownerOf` says which block a row belongs
// to, and the regions it parses out carry filled-
// in values rather than the variables the emitted
// template named.
const owner: Owner = ownerOf('find_slot.r3');
const regions: readonly RecordedSegment[] =
  owner.kind === 'node' ? owner.segments : [];

const rows: readonly RecordedRow[] = [
  { functionId: 0, name: 'claim_filed', completedAt: 1, failed: false },
];

// Where a replay may start, which rows are not on
// offer, and whether the run still walks a path
// this document allows.
const points: { offered: ReplayBoundary[]; unoffered: Unoffered[] } =
  replayBoundaries(ir, rows);
const grammar: TraceGrammar = traceGrammar(ir);
const verdict: TraceMatch = matchTrace(grammar, rows, 0);

// The two halves the grammar is held between: what
// the emitter planned to write, and the step names
// it actually wrote into a file.
const emission: EmissionPlan = planWorkflow(ir);
const written: string[] = recordedNameLiterals(
  "await DBOS.runStep(() => charge(), { name: 'charge_card' });",
);

// @ts-expect-error every kind is drawn in one box,
// so nothing computes a height from a count of the
// config rows a node would have shown
const baseHeight = core.NODE_BASE_HEIGHT;

// @ts-expect-error the same removal, from the
// other end: there is no config row to have a
// height
const configRowHeight = core.CONFIG_ROW_HEIGHT;

export type {};
void [
  declaredAt,
  boxes,
  nodeHeight,
  position,
  reason,
  calledOut,
  wholeCall,
  decided,
  dropped,
  carried,
  bare,
  edgeId,
  afterRename,
  afterDelete,
  gallery,
  used,
  fromDocument,
  fromNothing,
  retry,
  appDir,
  sdkOwned,
  regions,
  points,
  verdict,
  emission,
  written,
  baseHeight,
  configRowHeight,
];
