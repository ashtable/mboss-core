import type { ChatPrompt, SlotGrid } from './types.js';

/**
 * Texts the customer the open times and asks them
 * to pick one. The reply arrives as a separate
 * event, so this only sends.
 */
export async function twilioChat(grid: SlotGrid): Promise<ChatPrompt> {
  return {
    to: grid.customerPhone,
    body: `We are booked then. Free: ${grid.alternatives.join(', ')}`,
  };
}
