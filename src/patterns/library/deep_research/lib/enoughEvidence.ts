import type { Evidence } from './deepResearchTypes.js';

/**
 * How many sources the report is allowed to lean
 * on before it is written. Yours to move.
 */
const ENOUGH_SOURCES = 3;

/**
 * Decides whether to search again or start
 * writing.
 *
 * The two answers are the two arms the branch
 * draws, and `false` is the one that wires back.
 * The round limit on that arm is what stops a
 * search that never satisfies this from running
 * forever; when it runs out, the run carries on to
 * the report with whatever it has.
 */
export async function enoughEvidence(evidence: Evidence): Promise<boolean> {
  return evidence.sources.length >= ENOUGH_SOURCES;
}
