import type { BuildArtifact, ReleaseRequest } from './deploymentTypes.js';

/**
 * Builds the thing that is going to be shipped.
 *
 * Whatever this returns waits in the workflow
 * database until somebody answers the approval
 * after it, which may be tomorrow. Return an
 * immutable reference — an image digest, a
 * versioned archive key — rather than anything
 * that a later build could overwrite underneath
 * the run.
 */
export async function buildRelease(
  request: ReleaseRequest,
): Promise<BuildArtifact> {
  return {
    releaseId: request.releaseId,
    imageRef: `registry.example.com/app@${request.commitSha}`,
    environment: request.environment,
  };
}
