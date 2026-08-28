import type { BookingReq, WebhookEvent } from './types.js';

/**
 * Flattens the incoming webhook into the shape the
 * rest of the workflow reads.
 *
 * @param event the raw booking request
 * @returns the parsed request
 */
export function parseRequest(event: WebhookEvent): BookingReq {
  return {
    requestId: event.requestId,
    customerEmail: event.customer.email,
    customerPhone: event.customer.phone,
    service: event.service,
    requestedAt: event.requestedAt,
  };
}
