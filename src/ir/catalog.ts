import { z } from 'zod';

import { NodeBase, NodeIdSchema, PredicateSchema } from './types.js';

/**
 * The node catalog: the kinds a workflow can be
 * built from, the config each one carries, and
 * the labels the canvas palette draws them with.
 *
 * Ten kinds, deliberately. Queues, child
 * workflows, compensation and map blocks are not
 * here — nothing in the product needs them yet,
 * and a kind is far cheaper to add than to
 * remove once workflows on disk use it.
 */
export const NodeKindSchema = z.enum([
  'trigger',
  'step',
  'transaction',
  'apiCall',
  'branch',
  'loop',
  'durableWait',
  'approval',
  'emailSend',
  'codeStep',
]);

/**
 * A step has no config of its own: what it does
 * is its handler, and how it behaves is the
 * shared `retry`, `forEach` and `guard`
 * modifiers.
 */
export const StepConfigSchema = z.object({});

/**
 * A transaction is a step whose handler writes
 * through the app's datasource client. It is
 * reserved strictly for the app's own co-located
 * database — a write to anything external is a
 * step, because only the local database can join
 * the run's transaction.
 */
export const TransactionConfigSchema = z.object({});

/**
 * The escape hatch: arbitrary code, no semantic
 * config at all. Anything a code step needs to
 * know lives in the handler it names.
 */
export const CodeStepConfigSchema = z.object({});

/**
 * An API call compiles exactly like a step. The
 * service name is display and convention only —
 * it tells a reader of the canvas which external
 * system is on the other end.
 */
export const ApiCallConfigSchema = z.object({ service: z.string() });

/**
 * How a run starts. The canvas shows friendly
 * knobs (run / start / repeat / ends) and stores
 * the cron expression and bounds they add up to.
 *
 * Event mode is also the ingress contract:
 * `idempotencyKeyPath` is what makes a redelivered
 * webhook start one run rather than two, and
 * `requesterEmailPath` is the only place an email
 * to the requesting user can come from.
 */
export const TriggerConfigSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('manual') }),
  z.object({
    mode: z.literal('event'),
    topic: z.string(),
    idempotencyKeyPath: z.string().optional(),
    requesterEmailPath: z.string().optional(),
  }),
  z.object({
    mode: z.literal('schedule'),
    cron: z.string(),
    timezone: z.string().optional(),
    start: z.iso.datetime().optional(),
    ends: z.iso.datetime().optional(),
  }),
]);

/**
 * One branch outcome. `maxIterations` and
 * `onExhausted` matter only for a case that
 * originates a back edge: they are the bound the
 * compiled loop runs under, and whether
 * exhausting it fails the run or falls through to
 * the next case.
 */
export const BranchCaseSchema = z.object({
  port: z.string(),
  when: PredicateSchema,
  maxIterations: z.number().int().min(1).default(10),
  onExhausted: z.enum(['abort', 'continue']).default('abort'),
});

/**
 * Ordered cases, first match wins, everything
 * else leaves by `elsePort`. At least one case is
 * required — a branch with none is just an edge
 * drawn with extra steps.
 *
 * Every port is distinct, fall-through included,
 * because a port is how an edge says which outcome
 * it belongs to. Two cases sharing one leaves
 * nothing able to decide which edge carries which
 * case, and an `elsePort` equal to a case port
 * leaves the fall-through no way out of its own.
 */
export const BranchConfigSchema = z
  .object({
    cases: z.array(BranchCaseSchema).min(1),
    elsePort: z.string(),
  })
  .refine(
    (config) => {
      const ports = [
        ...config.cases.map((branchCase) => branchCase.port),
        config.elsePort,
      ];

      return new Set(ports).size === ports.length;
    },
    {
      message: 'every case and the fall-through need a port of their own',
      path: ['cases'],
    },
  );

/**
 * A bounded repeat over a contiguous run of
 * nodes. `models` maps a role to the model id
 * chosen at authoring time and is stored in the
 * IR so a compiled app pins the same model the
 * author saw.
 */
export const LoopConfigSchema = z
  .object({
    minRounds: z.number().int().min(1),
    maxRounds: z.number().int().min(1),
    body: z.array(NodeIdSchema),
    models: z.record(z.string(), z.string()).optional(),
  })
  .refine((config) => config.maxRounds >= config.minRounds, {
    message: 'maxRounds must be at least minRounds',
    path: ['maxRounds'],
  });

/**
 * What a run is waiting for. An event source
 * declares both halves of its correlation:
 * `correlateWith` is read from the wait node's
 * input when the run parks, `correlationPath` is
 * read from the inbound event, and the ingress
 * route matches one against the other.
 */
export const WaitSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('form'), email: NodeIdSchema }),
  z.object({
    kind: z.literal('event'),
    topic: z.string(),
    correlationPath: z.string(),
    correlateWith: z.string(),
  }),
  z.object({ kind: z.literal('timer'), seconds: z.number().int().positive() }),
]);

/**
 * A durable pause. `onTimeout` is required
 * because a wait with no answer has to do
 * something, and leaving that implicit is how
 * runs hang forever.
 */
export const DurableWaitConfigSchema = z.object({
  source: WaitSourceSchema,
  timeoutDays: z.number().positive().optional(),
  onTimeout: z.enum(['resend', 'abort']),
  maxResends: z.number().int().nonnegative().optional(),
  afterMax: z.enum(['abort', 'continue']).optional(),
});

/**
 * Who an email goes to. `requestingUser` resolves
 * at run time from the trigger's declared
 * requester path — validation rejects it when the
 * workflow has no such trigger, because the
 * address has to come from somewhere.
 */
export const RecipientSchema = z.union([
  z.literal('requestingUser'),
  z.email(),
]);

/**
 * Approval is sugar: an email carrying a
 * single-decision form, and a durable wait on the
 * reply. It is a kind of its own because it is
 * one block on the canvas, not because it needs a
 * new primitive underneath.
 */
export const ApprovalConfigSchema = z.object({
  to: RecipientSchema,
  subject: z.string().optional(),
  message: z.string().optional(),
  timeoutDays: z.number().positive().optional(),
});

/**
 * One field of a form. `showIf` makes a field
 * conditional on an answer already given, which
 * is why a form is data rather than code.
 */
export const FormFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'fileUpload', 'yesNo']),
  required: z.boolean().optional(),
  multiple: z.boolean().optional(),
  showIf: PredicateSchema.optional(),
});

/**
 * A form has no code behind it, so its whole
 * definition is its fields.
 */
export const FormDefSchema = z.object({ fields: z.array(FormFieldSchema) });

/**
 * What the email carries beyond its body. A form
 * lives here rather than in a node of its own: a
 * form never exists without the email that
 * delivers its link.
 */
export const AttachmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('form'), form: FormDefSchema }),
  z.object({ type: z.literal('artifactLink'), artifactPath: z.string() }),
]);

/**
 * An email the run sends. Subject and body are
 * required — an email with neither is a bug that
 * only shows up in someone's inbox.
 */
export const EmailSendConfigSchema = z.object({
  to: RecipientSchema,
  subject: z.string(),
  bodyMarkdown: z.string(),
  attach: AttachmentSchema,
});

/**
 * A node, discriminated on `kind`.
 *
 * Discriminated rather than a plain union so that
 * a typo in `kind` is reported once, against
 * `kind`, instead of as ten config mismatches the
 * author has to read past to find the real one.
 */
export const NodeSchema = z.discriminatedUnion('kind', [
  NodeBase.extend({
    kind: z.literal('trigger'),
    config: TriggerConfigSchema,
  }),
  NodeBase.extend({ kind: z.literal('step'), config: StepConfigSchema }),
  NodeBase.extend({
    kind: z.literal('transaction'),
    config: TransactionConfigSchema,
  }),
  NodeBase.extend({ kind: z.literal('apiCall'), config: ApiCallConfigSchema }),
  NodeBase.extend({ kind: z.literal('branch'), config: BranchConfigSchema }),
  NodeBase.extend({ kind: z.literal('loop'), config: LoopConfigSchema }),
  NodeBase.extend({
    kind: z.literal('durableWait'),
    config: DurableWaitConfigSchema,
  }),
  NodeBase.extend({
    kind: z.literal('approval'),
    config: ApprovalConfigSchema,
  }),
  NodeBase.extend({
    kind: z.literal('emailSend'),
    config: EmailSendConfigSchema,
  }),
  NodeBase.extend({
    kind: z.literal('codeStep'),
    config: CodeStepConfigSchema,
  }),
]);

export type NodeKind = z.infer<typeof NodeKindSchema>;
export type BranchCase = z.infer<typeof BranchCaseSchema>;
export type WaitSource = z.infer<typeof WaitSourceSchema>;
export type Recipient = z.infer<typeof RecipientSchema>;
export type FormField = z.infer<typeof FormFieldSchema>;
export type FormDef = z.infer<typeof FormDefSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type WorkflowNode = z.infer<typeof NodeSchema>;

/**
 * The ports a node's outgoing edges may leave
 * from, in the order the canvas draws them.
 *
 * Validation, layout and the compiler all have to
 * agree on this exactly — a port list that
 * differs between them shows up as an edge that
 * validates, draws, and then compiles into a
 * branch nothing reaches. So there is one
 * implementation and they all call it.
 */
export function portsOf(node: WorkflowNode): string[] {
  switch (node.kind) {
    case 'branch':
      return [
        ...node.config.cases.map((branchCase) => branchCase.port),
        node.config.elsePort,
      ];

    case 'approval':
      return ['approved', 'rejected'];

    default:
      return ['out'];
  }
}

/**
 * Which drawer of the canvas palette a kind
 * belongs in. `control` covers the blocks that
 * decide where a run goes next, a durable wait
 * included — it suspends the run rather than
 * doing work in it.
 */
export type NodePaletteGroup = 'start' | 'work' | 'control' | 'people';

/**
 * How one kind is offered to an author.
 */
export type NodePaletteEntry = {
  kind: NodeKind;
  label: string;
  group: NodePaletteGroup;
};

/**
 * The palette, in the order it is drawn. This is
 * the only place a kind's human-facing name is
 * written down, so the canvas, the MCP server's
 * catalog resource and any future CLI all show
 * the author the same word.
 */
export const NODE_PALETTE: readonly NodePaletteEntry[] = [
  { kind: 'trigger', label: 'Trigger', group: 'start' },
  { kind: 'step', label: 'Step', group: 'work' },
  { kind: 'transaction', label: 'Transaction', group: 'work' },
  { kind: 'apiCall', label: 'API call', group: 'work' },
  { kind: 'codeStep', label: 'Code step', group: 'work' },
  { kind: 'branch', label: 'Branch', group: 'control' },
  { kind: 'loop', label: 'Loop', group: 'control' },
  { kind: 'durableWait', label: 'Wait', group: 'control' },
  { kind: 'approval', label: 'Approval', group: 'people' },
  { kind: 'emailSend', label: 'Email', group: 'people' },
];
