import type { Order, RefundResult } from './refundApprovalTypes.js';

/**
 * Records that the order was refunded.
 *
 * Writes nothing, because a project on its first
 * day has no orders table to write to. Once you
 * have one, write it through `appDb.client` from
 * `src/app/db.ts` — the database handle scoped to
 * this block's transaction, so the row and the
 * run's own checkpoint commit together or neither
 * does.
 *
 * What must not go here is a call to another
 * service. A transaction is a database write and
 * nothing else: a service call inside one cannot
 * be rolled back with it, and the canvas refuses
 * a transaction whose handler makes one.
 */
export async function markRefunded(result: RefundResult): Promise<Order> {
  return {
    orderId: result.orderId,
    refundId: result.refundId,
    status: 'refunded',
  };
}
