/**
 * The payloads the refund workflow wires its
 * blocks together with.
 *
 * Field names are not decorative: the drawing
 * addresses `refundId` as the key that stops a
 * redelivered event refunding twice, and
 * `customer.email` as the only place it knows to
 * write back to. Renaming either one here means
 * renaming it on the trigger as well.
 */

/** A refund request, as it arrives on the event. */
export interface RefundRequest {
  refundId: string;
  orderId: string;
  customer: { email: string; name: string };
  reason: string;
}

/** What was bought, looked up from the order. */
export interface Purchase {
  refundId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  purchasedAt: string;
  customerEmail: string;
}

/**
 * What the policy decided.
 *
 * An alias rather than a union written out on the
 * function, because these two values are the two
 * arms the branch draws: adding a third here means
 * drawing the arm that carries it.
 */
export type RefundVerdict = 'auto_approve' | 'review';

/** A refund the payment service accepted. */
export interface RefundResult {
  refundId: string;
  orderId: string;
  amountCents: number;
  paymentReference: string;
}

/** The order, once the refund is recorded. */
export interface Order {
  orderId: string;
  refundId: string;
  status: 'refunded';
}
