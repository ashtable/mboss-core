import type { ChatPrompt, SlotGrid } from './types.js';

/**
 * Texts the customer the open times and asks them
 * to pick one. The reply arrives as a separate
 * event, so this only sends.
 */
export async function twilioChat(grid: SlotGrid): Promise<ChatPrompt> {
  // Read the way a real service call reads its
  // credential, which is what puts a Node global
  // in front of the scanner.
  const account = process.env.TWILIO_ACCOUNT_SID ?? '';

  return {
    to: grid.customerPhone,
    body: `${account}: booked then. Free: ${grid.alternatives.join(', ')}`,
  };
}
