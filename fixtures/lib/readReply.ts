import type { ChatPrompt, ChatReply } from './types.js';

/**
 * Reads the customer's answer to the message that
 * was just sent them.
 *
 * A block rather than a durable wait, so the retry
 * loop the branch fixtures draw can be compiled on
 * its own: what those fixtures are about is the
 * loop, and a wait would put a second unrelated
 * shape inside every one of them.
 */
export async function readReply(prompt: ChatPrompt): Promise<ChatReply> {
  return {
    from: prompt.to,
    intent: prompt.body.includes('later') ? 'reschedule' : 'book',
    requestedAt: '',
  };
}
