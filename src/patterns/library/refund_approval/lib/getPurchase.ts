import type { Purchase, RefundRequest } from './refundApprovalTypes.js';

/**
 * Looks up what the customer bought.
 *
 * A stand-in that answers out of the request
 * itself, so the workflow runs on the day it is
 * created. Replace the body with the read your own
 * order store needs; what it gives back is the
 * shape every block after it is wired against.
 */
export async function getPurchase(request: RefundRequest): Promise<Purchase> {
  return {
    refundId: request.refundId,
    orderId: request.orderId,
    amountCents: 2500,
    currency: 'USD',
    purchasedAt: '2026-01-01T00:00:00.000Z',
    customerEmail: request.customer.email,
  };
}
