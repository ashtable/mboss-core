/**
 * The payloads the webhook workflow wires its
 * blocks together with.
 *
 * `deliveryId` is the whole of "once". The trigger
 * names it as the key a run is started under, so a
 * provider that delivers the same event twice
 * starts one run and the second delivery joins it.
 * Nothing below checks whether the event was seen
 * before, because nothing below has to.
 */

/** Who sent it. */
export type WebhookSource = 'stripe' | 'github';

/** A delivery, exactly as it arrived. */
export interface WebhookDelivery {
  deliveryId: string;
  source: WebhookSource;
  eventType: string;
  signature: string;
  body: string;
}

/**
 * The same delivery, once the signature held.
 *
 * `payload` is the parsed body. It is left open
 * because every provider sends a different shape —
 * narrow it to your own once you know which events
 * you handle.
 */
export interface VerifiedDelivery {
  deliveryId: string;
  source: WebhookSource;
  eventType: string;
  payload: Record<string, unknown>;
}

/** What the write left behind. */
export interface AppliedEvent {
  deliveryId: string;
  eventType: string;
  recordId: string;
}

/** The receipt the source was given. */
export interface Acknowledgement {
  deliveryId: string;
  accepted: boolean;
}
