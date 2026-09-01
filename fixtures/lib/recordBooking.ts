import { appDb } from '../src/app/db.js';

import type { Booking } from './types.js';

/**
 * Writes the confirmed booking to the app's own
 * database, through the transaction-scoped client.
 */
export async function recordBooking(booking: Booking): Promise<Booking> {
  // `appDb.client` is the whole reason the block
  // is drawn as a transaction: what it writes
  // commits with the run's own checkpoint or not
  // at all. A generated project ships one table
  // of its own, the runtime's, so what this
  // writes is the one thing that table knows
  // about — a booking that is recorded has
  // nothing still waiting on the customer, so any
  // row left from an abandoned attempt goes with
  // it.
  await appDb.client.waitCorrelation.deleteMany({
    where: { key: booking.customerEmail },
  });

  return booking;
}
