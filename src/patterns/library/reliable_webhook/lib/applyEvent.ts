import type { AppliedEvent, VerifiedDelivery } from './reliableWebhookTypes.js';

/**
 * Writes what the event says into your own
 * database.
 *
 * There is no "have I seen this before?" here, and
 * there should not be: the trigger's key already
 * decided that a redelivered event joins the run
 * that is under way rather than starting a second
 * one. A check in this handler would be a second
 * answer to a question already settled, and the
 * two would eventually disagree.
 *
 * Writes nothing, because a project on its first
 * day has no table to write to. Once you have one,
 * write it through `appDb.client` from
 * `src/app/db.ts`, so the row and the run's own
 * checkpoint commit together or neither does. What
 * must not go here is a call to another service: a
 * transaction is a database write and nothing
 * else, and the canvas refuses a transaction whose
 * handler makes one.
 */
export async function applyEvent(
  delivery: VerifiedDelivery,
): Promise<AppliedEvent> {
  return {
    deliveryId: delivery.deliveryId,
    eventType: delivery.eventType,
    recordId: `record-${delivery.deliveryId}`,
  };
}
