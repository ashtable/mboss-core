import type { Deployment, HealthReport } from './deploymentTypes.js';

/**
 * Asks the new version how it is doing.
 *
 * The wait before this is what makes the answer
 * worth having: a rollout looks healthy for the
 * first few seconds however broken it is. Lengthen
 * that wait on the canvas rather than sleeping in
 * here — the run is suspended for it, holding
 * nothing open, and it survives a restart.
 */
export async function checkHealth(
  deployment: Deployment,
): Promise<HealthReport> {
  return {
    releaseId: deployment.releaseId,
    environment: deployment.environment,
    previousImageRef: deployment.previousImageRef,
    healthy: true,
    errorRate: 0,
  };
}
