import type { Charge, Reservation } from './checkoutTypes.js';

/**
 * Takes the money.
 *
 * Drawn as an API call because that is what it is,
 * and it is the one block here that reaches
 * outside. The block retries it on a failure, so
 * pass `reservationId` to your provider as the
 * idempotency key — that is what keeps a retry
 * from charging the customer twice.
 *
 * A declined card is an answer, not a failure:
 * come back with `declined` so the branch after
 * this can take the other arm. Throw only when you
 * do not know what happened, which is what a retry
 * is for.
 */
export async function chargeCard(reservation: Reservation): Promise<Charge> {
  return {
    orderId: reservation.orderId,
    reservationId: reservation.reservationId,
    status: 'captured',
    chargeReference: `charge-${reservation.reservationId}`,
  };
}
