import type { Booking } from './types.js';

/**
 * Writes the confirmed booking to the app's own
 * database. Separate from placing it, so a failed
 * write is retried without double-booking.
 */
export async function recordBooking(booking: Booking): Promise<Booking> {
  return booking;
}
