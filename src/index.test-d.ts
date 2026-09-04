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
 * that is what a consumer writes and because a
 * name two modules both export through `export *`
 * is silently left off the surface — the drop
 * shows up here as a member that is not there.
 */
import * as core from './index.js';
import {
  NODE_HEIGHT,
  PositionSchema,
  carryPositions,
  decisionValues,
  deleteNode,
  handlerFit,
  nextEdgeId,
  place,
  renameNode,
  starterId,
  starterNode,
  withDecisionCases,
  withoutPositions,
} from './index.js';

import type {
  ExternalCall,
  HandlerFit,
  HandlerMisfit,
  LibFunction,
  NodeBox,
  Position,
  WorkflowIR,
  WorkflowNode,
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
  params: [{ name: 'claim', type: 'Claim', optional: false }],
  returnType: 'boolean',
  decision: [true, false],
};

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
  baseHeight,
  configRowHeight,
];
