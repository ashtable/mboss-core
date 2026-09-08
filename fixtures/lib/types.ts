/**
 * The payload types the groom-booking workflow
 * wires its blocks together with.
 *
 * Field names are not decorative: the workflow's
 * trigger, branch and wait configs address them by
 * dot-path, so renaming one here invalidates the
 * IR fixture that reads it.
 */

/** The raw event the booking request arrives as. */
export interface WebhookEvent {
  requestId: string;
  customer: { email: string; name: string; phone: string };
  service: string;
  requestedAt: string;
}

/** A booking request after parsing. */
export interface BookingReq {
  requestId: string;
  customerEmail: string;
  customerPhone: string;
  service: string;
  requestedAt: string;
}

/** Availability around the requested time. */
export interface SlotGrid {
  requestedSlotFree: boolean;
  requestedAt: string;
  alternatives: string[];
  customerEmail: string;
  customerPhone: string;
}

/** An outbound SMS awaiting a reply. */
export interface ChatPrompt {
  to: string;
  body: string;
}

/**
 * A reply to that SMS. A type alias rather than an
 * interface so the scanner is exercised on both
 * ways of exporting a type.
 */
export type ChatReply = {
  from: string;
  intent: 'book' | 'reschedule' | 'cancel';
  requestedAt: string;
};

/** A confirmed appointment. */
export interface Booking {
  bookingId: string;
  customerEmail: string;
  service: string;
  startsAt: string;
}

/** A batch of items handed to one indexing run. */
export interface Batch {
  batchId: string;
  items: Item[];
}

/**
 * One item of a batch. `customerId` is what the
 * queue partitions on, so renaming it invalidates
 * the IR fixture that reads it.
 */
export interface Item {
  itemId: string;
  customerId: string;
  body: string;
}

/** What indexing one item produced. */
export interface Indexed {
  itemId: string;
  terms: number;
}
