import type { HealthReport, Rollback } from './deploymentTypes.js';

/**
 * Puts the previous version back in front of
 * traffic.
 *
 * The reference it restores is the one the deploy
 * carried out, passed along by the health check —
 * so a rollback goes back to what was actually
 * serving rather than to whatever is newest in the
 * registry now.
 */
export async function rollBack(report: HealthReport): Promise<Rollback> {
  return {
    releaseId: report.releaseId,
    restoredImageRef: report.previousImageRef,
  };
}
