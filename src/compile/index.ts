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
  type RegistryEntry,
} from './compile.js';
export {
  determinismProblems,
  headerProblems,
  registrationProblems,
  stepProblems,
  type AuditProblem,
} from './audit.js';
export { UnsupportedIR } from './unsupported.js';
export * from './typecheck.js';
