/**
 * The payloads the release workflow wires its
 * blocks together with.
 *
 * The wait between deploying and checking health
 * binds no value of its own — nothing arrives, it
 * is only time passing — so the health check reads
 * what the deploy produced, straight across the
 * pause.
 */

/** A release somebody asked for. */
export interface ReleaseRequest {
  releaseId: string;
  commitSha: string;
  environment: string;
}

/** What the build produced. */
export interface BuildArtifact {
  releaseId: string;
  imageRef: string;
  environment: string;
}

/** The rollout, once it is under way. */
export interface Deployment {
  releaseId: string;
  environment: string;
  previousImageRef: string;
}

/** How the new version is doing. */
export interface HealthReport {
  releaseId: string;
  environment: string;
  previousImageRef: string;
  healthy: boolean;
  errorRate: number;
}

/** The way back, once it has been taken. */
export interface Rollback {
  releaseId: string;
  restoredImageRef: string;
}
