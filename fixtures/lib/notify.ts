import type { Booking } from './types.js';

/**
 * Sends the shop a note about a new booking.
 *
 * Exported as the module's default, which is the
 * one shape a generated workflow cannot import: it
 * emits `import { notify } from …`, and there is no
 * such named export here.
 */
export default async function notify(booking: Booking): Promise<string> {
  return `booked ${booking.bookingId}`;
}
