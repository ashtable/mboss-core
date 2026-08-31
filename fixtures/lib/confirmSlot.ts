import type { Booking } from './types.js';

/**
 * Confirms one of the alternative times the slot
 * grid offered.
 *
 * Takes a single alternative rather than the grid,
 * which is what a block that fans out needs: the
 * generated code hands its handler one item at a
 * time.
 */
export async function confirmSlot(slot: string): Promise<Booking> {
  return {
    bookingId: `bk_${slot}`,
    customerEmail: '',
    service: 'groom',
    startsAt: slot,
  };
}
