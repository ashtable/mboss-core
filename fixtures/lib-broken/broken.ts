import type { BookingReq } from './types.js';

/**
 * Deliberately mistyped: `service` is a string and
 * the declared return type is a number.
 *
 * A project whose code-behind does not compile is
 * the ordinary mid-edit state, so the scanner has
 * to report this rather than throw. This directory
 * exists so the clean fixture's golden manifest is
 * not polluted by the error.
 */
export function serviceCode(req: BookingReq): number {
  return req.service;
}
