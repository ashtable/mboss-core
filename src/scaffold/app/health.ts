// Written by mBoss when this project was created.
// It is yours now — edit it freely.

/**
 * What `GET /healthz` answers.
 *
 * It reads nothing: no database, no environment,
 * no workflow registry. That is a deliberate
 * trade, and it cuts both ways. A check that
 * touched the database would go red during an
 * ordinary failover and take the whole service out
 * of rotation for something the platform cannot
 * fix by restarting; a check that touches nothing
 * stays green while every real route is failing.
 * This answers one question — the process is up
 * and serving — and leaves the rest to your own
 * monitoring.
 */
export function healthPayload(): { ok: true } {
  return { ok: true };
}
