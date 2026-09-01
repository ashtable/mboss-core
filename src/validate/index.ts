import type { WorkflowIR } from '../ir/index.js';
import type { LibManifest } from '../manifest/index.js';

import type { Diagnostic } from './diagnostic.js';
import { buildGraph } from './graph.js';
import { RULES } from './rules.js';

/**
 * Validation: what a workflow document has to be
 * true about itself.
 *
 * The rules run over a document that has already
 * parsed, so they are about meaning rather than
 * shape — a wire carrying a type its consumer
 * cannot take, a loop that re-enters somewhere the
 * run may never have been. The canvas, the MCP
 * server and the compiler all ask the same
 * question here, so an agent and a person get the
 * same answer about the same file.
 */

/**
 * Checks a workflow and returns everything found,
 * in rule order.
 *
 * The `/lib` manifest is optional. Without it the
 * rules that name it still do the work that needs
 * no manifest — an edge type is compared against
 * what its ends declare, a handler is checked for
 * being present — because validation runs in tools
 * that never scan a project, and a document should
 * not look clean merely because nothing was there
 * to check it. The two rules that read only the
 * scan report nothing at all.
 */
export function validateWorkflow(
  ir: WorkflowIR,
  opts?: { manifest?: LibManifest },
): Diagnostic[] {
  const ctx = { ir, graph: buildGraph(ir), manifest: opts?.manifest };

  return RULES.flatMap((rule) => rule(ctx));
}

/**
 * Whether anything found is fatal. This is the
 * gate an edit has to pass: a document with
 * warnings is a draft, and drafts are saved all
 * day long.
 */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

/**
 * Whether this document can be compiled into a
 * running app.
 *
 * Stricter than the gate an edit passes, in the
 * two places where a legal draft is still not a
 * program: a missing handler is only a warning
 * because blocks are drawn before their code
 * exists, but there is no function to call; and a
 * workflow with no trigger is a legal draft with
 * no way to start.
 */
export function canCompile(
  ir: WorkflowIR,
  diagnostics: readonly Diagnostic[],
): boolean {
  const triggers = ir.nodes.filter((node) => node.kind === 'trigger');

  return (
    triggers.length === 1 &&
    !hasErrors(diagnostics) &&
    !diagnostics.some((diagnostic) => diagnostic.code === 'V07')
  );
}

export {
  DiagnosticCodeSchema,
  DiagnosticSeveritySchema,
  DiagnosticSchema,
} from './diagnostic.js';

export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from './diagnostic.js';
