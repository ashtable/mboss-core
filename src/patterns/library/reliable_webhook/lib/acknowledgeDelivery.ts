import type { Acknowledgement, AppliedEvent } from './reliableWebhookTypes.js';

/**
 * Tells the source the event was applied.
 *
 * Not the HTTP response — the ingress answered
 * that the moment the delivery arrived, long
 * before this runs. This is the call back to the
 * provider that some of them offer: updating a
 * check run, closing out a dispute, marking a task
 * done. Delete the block if yours has nothing of
 * the kind.
 */
export async function acknowledgeDelivery(
  applied: AppliedEvent,
): Promise<Acknowledgement> {
  return { deliveryId: applied.deliveryId, accepted: true };
}
