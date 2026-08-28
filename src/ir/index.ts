/**
 * The Workflow IR: the one semantic model of a
 * workflow that the canvas, the MCP server,
 * validation and the compiler all share.
 *
 * A workflow on disk is JSON, and this is what
 * that JSON is allowed to be. Everything
 * downstream parses through these schemas rather
 * than trusting the file, because the file is
 * written by agents as well as by the canvas.
 */
export {
  WorkflowNameSchema,
  NodeIdSchema,
  TypeNameSchema,
  PredicateSchema,
  RetrySchema,
  FanOutSchema,
  HandlerRefSchema,
  NodeBase,
  EdgeSchema,
} from './types.js';
export {
  NodeKindSchema,
  StepConfigSchema,
  TransactionConfigSchema,
  CodeStepConfigSchema,
  ApiCallConfigSchema,
  TriggerConfigSchema,
  BranchCaseSchema,
  BranchConfigSchema,
  LoopConfigSchema,
  WaitSourceSchema,
  DurableWaitConfigSchema,
  RecipientSchema,
  ApprovalConfigSchema,
  FormFieldSchema,
  FormDefSchema,
  AttachmentSchema,
  EmailSendConfigSchema,
  NodeSchema,
  portsOf,
  NODE_PALETTE,
} from './catalog.js';
export { WorkflowIRSchema } from './workflow.js';

export type {
  Predicate,
  Retry,
  FanOut,
  HandlerRef,
  WorkflowEdge,
} from './types.js';
export type {
  NodeKind,
  BranchCase,
  WaitSource,
  Recipient,
  FormField,
  FormDef,
  Attachment,
  WorkflowNode,
  NodePaletteGroup,
  NodePaletteEntry,
} from './catalog.js';
export type { WorkflowIR } from './workflow.js';
