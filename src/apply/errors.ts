import type { Diagnostic } from '../validate/index.js';

/**
 * What can go wrong applying an edit, as data.
 *
 * These are returned, never thrown, because every
 * one of them is a normal outcome of a well-formed
 * request that an agent or a canvas is expected to
 * handle: re-read and retry after a conflict,
 * show the errors after a failed validation,
 * mint a fresh proposal after a stale one. A
 * broken project or a broken disk is a different
 * thing and still throws.
 *
 * The codes are product surface — the MCP server
 * returns them to agents and the extension matches
 * on them — so they are stable, and a meaning that
 * changes gets a new code rather than reusing one.
 */
export type ApplyError =
  | { code: 'NOT_AN_MBOSS_PROJECT'; path: string }
  | { code: 'WORKFLOW_NOT_FOUND'; name: string }
  | { code: 'REVISION_CONFLICT'; expected: number | null; actual: number }
  | { code: 'VALIDATION_FAILED'; errors: Diagnostic[] }
  | { code: 'PROPOSAL_NOT_FOUND'; id: string }
  | {
      code: 'PROPOSAL_STALE';
      baseRevision: number | null;
      currentRevision: number;
    }
  | { code: 'NOTHING_TO_UNDO'; name: string };

/**
 * The failing half of every result this module
 * returns. Written once so that a new operation
 * cannot invent its own shape for failure.
 */
export type Failure = { ok: false; error: ApplyError };

/**
 * Wraps an error as a failed result.
 */
export function failed(error: ApplyError): Failure {
  return { ok: false, error };
}
