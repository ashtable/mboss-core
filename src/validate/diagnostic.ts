import { z } from 'zod';

import { NodeIdSchema } from '../ir/index.js';

/**
 * What a validation rule reports, and the fixed
 * severity each rule reports it at.
 *
 * A diagnostic is product surface, not an internal
 * detail: the code is matched on by the MCP server
 * and the extension, and the message is read by a
 * person looking at a canvas. So the shape is a
 * schema — the same document round-trips through
 * JSON on its way to both.
 */

/**
 * The rule that produced a finding. Codes are
 * stable across releases because tools key off
 * them; a rule that changes meaning gets a new
 * code rather than reusing one.
 */
export const DiagnosticCodeSchema = z.enum([
  'V01',
  'V02',
  'V03',
  'V04',
  'V05',
  'V06',
  'V07',
  'V08',
  'V09',
  'V10',
  'V11',
  'V12',
  'V13',
  'V14',
  'V15',
]);

/**
 * Two severities and no more. The split is what
 * makes a half-built draft a legal document while
 * corruption stays impossible: warnings are things
 * an author has not done yet, errors are things
 * the document says that cannot be true.
 */
export const DiagnosticSeveritySchema = z.enum(['error', 'warning']);

/**
 * One finding.
 *
 * `nodeId` and `edgeId` are what let the canvas
 * draw the finding on the thing it is about, so a
 * rule sets whichever it can — a message with
 * neither can only be shown in a list.
 */
export const DiagnosticSchema = z.object({
  code: DiagnosticCodeSchema,
  severity: DiagnosticSeveritySchema,
  message: z.string(),
  nodeId: NodeIdSchema.optional(),
  edgeId: z.string().optional(),
});

export type DiagnosticCode = z.infer<typeof DiagnosticCodeSchema>;
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

/**
 * Where a finding sits in the document.
 */
export type DiagnosticSite = { nodeId?: string; edgeId?: string };

/**
 * The severity each rule reports at. Severity
 * belongs to the rule, not to the document — a
 * missing handler is a warning in every workflow
 * that has one — so it is written down once here
 * instead of being decided at each of the call
 * sites that report a finding.
 */
const RULE_SEVERITY: Record<DiagnosticCode, DiagnosticSeverity> = {
  V01: 'error',
  V02: 'error',
  V03: 'warning',
  V04: 'error',
  V05: 'error',
  V06: 'error',
  V07: 'warning',
  V08: 'error',
  V09: 'error',
  V10: 'error',
  V11: 'error',
  V12: 'error',
  V13: 'error',
  V14: 'error',
  V15: 'error',
};

/**
 * The three rules that are allowed to report
 * something softer than their own severity. They
 * are the rules about work not done yet — no
 * trigger, an island of nodes not wired up, a
 * block whose code does not exist — and every one
 * of them describes a state the authoring flow
 * passes through on purpose.
 */
type SoftCode = 'V01' | 'V03' | 'V07';

/**
 * Builds a finding at its rule's severity.
 */
export function diagnostic(
  code: DiagnosticCode,
  message: string,
  site: DiagnosticSite = {},
): Diagnostic {
  return { code, severity: RULE_SEVERITY[code], message, ...site };
}

/**
 * Builds a finding as a warning.
 *
 * Only one rule needs this: a workflow with no
 * trigger is a legal draft, while the other two
 * things the trigger rule finds — a second
 * trigger, an edge into one — are errors. The
 * argument type keeps the door narrow, so no
 * future rule can quietly downgrade an error by
 * reaching for the shorter constructor.
 */
export function warning(
  code: SoftCode,
  message: string,
  site: DiagnosticSite = {},
): Diagnostic {
  return { code, severity: 'warning', message, ...site };
}
