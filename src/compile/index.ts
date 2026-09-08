/**
 * The compiler: a workflow document in, the
 * TypeScript a generated project runs out.
 *
 * Nothing here reads the scaffold. The two write
 * into the same project — `src/workflows/` is the
 * compiler's, `src/app/` is the scaffold's — and
 * they agree through `src/app-contract/`, which
 * holds the paths, the import specifiers and the
 * table of runtime exports and nothing else.
 */
export {
  compileProject,
  compileRegistry,
  compileWorkflow,
  type CompileProjectOptions,
  type CompileProjectResult,
  type CompileRequest,
  type CompileResult,
  type QueueEntry,
  type RegistryEntry,
} from './compile.js';
export {
  determinismProblems,
  headerProblems,
  placementProblems,
  queueProblems,
  recordedNameLiterals,
  registrationProblems,
  stepProblems,
  type AuditProblem,
} from './audit.js';
export {
  SDK_OPERATIONS,
  ownerOf,
  queuedWorkflowName,
  type Owner,
  type RecordedSegment,
} from './names.js';
export {
  planWorkflow,
  type ArmTarget,
  type EmissionPlan,
  type GuardGroup,
  type PlanArm,
  type PlanItem,
  type PlanOptions,
  type PlanRegion,
  type RegionOutcome,
  type TriggerNode,
} from './plan.js';
export {
  matchTrace,
  replayBoundaries,
  traceGrammar,
  type RecordedRow,
  type ReplayBoundary,
  type TraceGrammar,
  type TraceMatch,
  type Unoffered,
} from './replay.js';
export { UnsupportedIR } from './unsupported.js';
export * from './typecheck.js';
