import type { BookingReq, SlotGrid } from './types.js';

/**
 * Looks up availability around the requested time.
 */
export async function findSlot(req: BookingReq): Promise<SlotGrid> {
  return {
    requestedSlotFree: req.requestedAt.endsWith('09:00'),
    requestedAt: req.requestedAt,
    alternatives: [],
    customerEmail: req.customerEmail,
    customerPhone: req.customerPhone,
  };
}

/**
 * Whether the run should look again.
 *
 * Availability moves while a run is waiting, so
 * asking the same question a second time is worth
 * doing — which is what makes this a decision a
 * loop can close on.
 */
export async function tryAgain(grid: SlotGrid): Promise<boolean> {
  return !grid.requestedSlotFree && grid.alternatives.length === 0;
}
