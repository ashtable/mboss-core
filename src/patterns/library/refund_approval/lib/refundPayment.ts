import type { Purchase, RefundResult } from './refundApprovalTypes.js';

/**
 * Sends the money back.
 *
 * Drawn as an API call because that is what it
 * becomes: the block retries it on a failure, and
 * `refundId` is what keeps a retry from paying the
 * customer twice. The stand-in reaches nothing —
 * put your provider's call here, keyed on that id.
 */
export async function refundPayment(purchase: Purchase): Promise<RefundResult> {
  return {
    refundId: purchase.refundId,
    orderId: purchase.orderId,
    amountCents: purchase.amountCents,
    paymentReference: `refund-${purchase.refundId}`,
  };
}
