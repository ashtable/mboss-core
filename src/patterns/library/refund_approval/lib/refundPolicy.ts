import type { Purchase, RefundVerdict } from './refundApprovalTypes.js';

/**
 * The most a refund can be worth before somebody
 * has to look at it. Yours to move.
 */
const AUTO_APPROVE_LIMIT_CENTS = 5000;

/**
 * Decides whether this refund needs a person.
 *
 * The two answers are the two arms the branch
 * draws. Returning a third value would leave the
 * run taking the fall-through, so add the arm at
 * the same time as the value.
 */
export async function refundPolicy(purchase: Purchase): Promise<RefundVerdict> {
  return purchase.amountCents <= AUTO_APPROVE_LIMIT_CENTS
    ? 'auto_approve'
    : 'review';
}
