import type { Charge, Fulfilment } from './checkoutTypes.js';

/**
 * Hands the paid order on to whoever ships it.
 *
 * A step rather than a transaction: this one talks
 * to a warehouse, and work that reaches another
 * system cannot join the run's database
 * transaction. It gets a step's own checkpoint
 * instead, so a run that is recovered after this
 * finished carries on from the next block rather
 * than shipping the order again.
 */
export async function fulfillOrder(charge: Charge): Promise<Fulfilment> {
  return {
    orderId: charge.orderId,
    shipmentId: `ship-${charge.orderId}`,
  };
}
