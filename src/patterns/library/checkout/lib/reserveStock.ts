import type { OrderPlaced, Reservation } from './checkoutTypes.js';

/**
 * Holds the stock this order needs.
 *
 * Writes nothing, because a project on its first
 * day has no inventory table to write to. Once you
 * have one, write it through `appDb.client` from
 * `src/app/db.ts` — the database handle scoped to
 * this block's transaction, so the hold and the
 * run's own checkpoint commit together or neither
 * does.
 *
 * What must not go here is a call to your
 * warehouse or to any other service. A transaction
 * is a database write and nothing else: a service
 * call inside one is not undone by the rollback,
 * and the canvas refuses a transaction whose
 * handler makes one.
 */
export async function reserveStock(order: OrderPlaced): Promise<Reservation> {
  return {
    orderId: order.orderId,
    reservationId: `hold-${order.orderId}`,
    amountCents: order.amountCents,
    currency: order.currency,
  };
}
