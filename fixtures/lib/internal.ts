import type { BookingReq } from './types.js';

/**
 * Not exported, so it must not reach the manifest:
 * the manifest is the palette of blocks a workflow
 * may call, and nothing outside this file can call
 * this.
 *
 * The type-only import is what makes this file a
 * module rather than a script, which is the state
 * a real helper file would be in.
 */
function slotKey(req: BookingReq): string {
  return `${req.service}@${req.requestedAt}`;
}
