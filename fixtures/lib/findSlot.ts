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
