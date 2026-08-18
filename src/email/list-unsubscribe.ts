/**
 * The one-click unsubscribe pair a bulk send
 * carries. `List-Unsubscribe-Post` is the exact
 * literal the RFC defines and admits no variation;
 * the mailbox address beside the URL is a fixed
 * fallback for clients that only understand
 * `mailto:`.
 *
 * It lives beside the templates rather than with
 * the URL builders because the broadcast template
 * is what decides whether a message carries the
 * pair at all — a test send has no subscriber and
 * so has nothing to unsubscribe.
 */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>, <mailto:unsubscribe@mboss.dev>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
