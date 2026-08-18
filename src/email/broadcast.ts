import { escapeHtml } from './html.js';
import { listUnsubscribeHeaders } from './list-unsubscribe.js';
import { renderMarkdown } from './markdown.js';
import type { EmailMessage } from './message.js';
import { renderShell } from './shell.js';

/**
 * The progress-update broadcast. Its whole
 * appearance comes out of three admin-supplied
 * fields, because those are the only three on the
 * wire: the subject, the body written as
 * Markdown, and an optional teaser image.
 *
 * The headline, the mono stat strip and the CTA
 * button the design shows are all shapes the
 * Markdown renderer recognises — a heading line,
 * a fenced block, a paragraph that is nothing but
 * a link. Adding a field for each of them would
 * be a wire change in three repos to say what an
 * author can already say in the body.
 */

const NOTE =
  "no action needed · we'll email again when there's something you can " +
  'install · pause or unsubscribe below';

export type BroadcastLinks = {
  manageUrl: string;
  unsubscribeUrl: string;
};

export function renderBroadcastEmail(input: {
  to: string;
  subject: string;
  bodyMarkdown: string;
  teaserImageUrl: string | null;
  /**
   * Null for a test send. It goes to an arbitrary
   * address with no subscriber behind it, so
   * there is no token to mint and nothing an
   * unsubscribe link could revoke — a minted one
   * would be a permanently dead link in a real
   * inbox.
   */
  links: BroadcastLinks | null;
}): EmailMessage {
  const body = [renderMarkdown(input.bodyMarkdown)];
  if (input.teaserImageUrl !== null) {
    body.push(
      `<img src="${escapeHtml(input.teaserImageUrl)}" alt="" ` +
        `style="max-width:100%;display:block;margin-top:14px">`,
    );
  }

  return {
    to: input.to,
    subject: input.subject,
    html: renderShell({
      body: body.join('\n'),
      note: NOTE,
      manageUrl: input.links?.manageUrl ?? null,
    }),
    ...(input.links === null
      ? {}
      : { headers: listUnsubscribeHeaders(input.links.unsubscribeUrl) }),
  };
}
