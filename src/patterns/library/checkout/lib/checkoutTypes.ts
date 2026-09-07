/**
 * The payloads the checkout workflow wires its
 * blocks together with.
 *
 * `orderId` is the key that stops a redelivered
 * `order.placed` starting a second run, and
 * `customer.email` is the only place either
 * closing email knows to write to. Renaming either
 * one here means renaming it on the trigger as
 * well.
 */

/** One line of the order. */
export interface LineItem {
  sku: string;
  quantity: number;
}

/** An order, as it arrives on the event. */
export interface OrderPlaced {
  orderId: string;
  customer: { email: string; name: string };
  items: LineItem[];
  amountCents: number;
  currency: string;
}

/**
 * Stock held for this order, with what the charge
 * needs travelling alongside it: the payment block
 * reads only what this says.
 */
export interface Reservation {
  orderId: string;
  reservationId: string;
  amountCents: number;
  currency: string;
}

/**
 * What the card did.
 *
 * An alias rather than a union written out on the
 * interface, because these two values are the two
 * arms the branch draws: adding a third here means
 * drawing the arm that carries it.
 */
export type ChargeStatus = 'captured' | 'declined';

/** The charge attempt and how it ended. */
export interface Charge {
  orderId: string;
  reservationId: string;
  status: ChargeStatus;
  chargeReference: string;
}

/** The order, handed to whoever ships it. */
export interface Fulfilment {
  orderId: string;
  shipmentId: string;
}

/** The hold, given back. */
export interface StockRelease {
  orderId: string;
  reservationId: string;
}
