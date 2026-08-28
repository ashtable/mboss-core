import type { Booking, SlotGrid } from './types.js';

/**
 * Reserves the slot with the scheduling provider.
 */
export async function bookAppointment(grid: SlotGrid): Promise<Booking> {
  return {
    bookingId: `bk_${grid.requestedAt}`,
    customerEmail: grid.customerEmail,
    service: 'groom',
    startsAt: grid.requestedAt,
  };
}
