import { parseRequest } from './parseRequest.js';
import type { WebhookEvent } from './types.js';

/**
 * A test file that lives beside the code it tests,
 * the way a real project's does. Nothing in here
 * may reach the manifest — `assertParses` is an
 * exported function, and the scan must still skip
 * it because of the file it is in.
 */
export function assertParses(event: WebhookEvent): void {
  if (parseRequest(event).requestId !== event.requestId) {
    throw new Error('parseRequest dropped the request id');
  }
}
