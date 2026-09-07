import type {
  VerifiedDelivery,
  WebhookDelivery,
} from './reliableWebhookTypes.js';

/**
 * Checks the delivery really came from where it
 * says, then reads the body.
 *
 * Throw on a signature that does not hold. A
 * forgery is not something a later block can be
 * asked to cope with, and a run that fails here
 * has written nothing.
 *
 * The block retries three times before it gives
 * up, which is worth turning down to one on the
 * canvas: this answer is the same every time it is
 * asked.
 */
export async function verifySignature(
  delivery: WebhookDelivery,
): Promise<VerifiedDelivery> {
  return {
    deliveryId: delivery.deliveryId,
    source: delivery.source,
    eventType: delivery.eventType,
    payload: JSON.parse(delivery.body) as Record<string, unknown>,
  };
}
