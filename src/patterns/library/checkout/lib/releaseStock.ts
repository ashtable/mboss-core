import type { Charge, StockRelease } from './checkoutTypes.js';

/**
 * Gives the hold back after a decline.
 *
 * The undo of `reserveStock`, and a transaction
 * for the same reason: it is a write to the app's
 * own database, so put it through `appDb.client`
 * from `src/app/db.ts` once you have a table.
 * Nothing here calls out — telling the customer is
 * the email block after this one.
 */
export async function releaseStock(charge: Charge): Promise<StockRelease> {
  return {
    orderId: charge.orderId,
    reservationId: charge.reservationId,
  };
}
