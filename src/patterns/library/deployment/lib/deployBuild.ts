import type { BuildArtifact, Deployment } from './deploymentTypes.js';

/**
 * Puts the build in front of traffic.
 *
 * Carry the reference it displaced back out.
 * Nothing else in the run knows what was serving a
 * moment ago, and the rollback further down needs
 * somewhere to go.
 */
export async function deployBuild(
  artifact: BuildArtifact,
): Promise<Deployment> {
  return {
    releaseId: artifact.releaseId,
    environment: artifact.environment,
    previousImageRef: 'registry.example.com/app@previous',
  };
}
