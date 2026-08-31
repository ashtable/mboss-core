/**
 * The one escape every admin-supplied string
 * passes through on its way into the email HTML:
 * body copy, link labels, hrefs, image URLs.
 *
 * It lives on its own rather than inside the
 * Markdown renderer because an image URL is not a
 * Markdown concern, and a single shared escape is
 * what stops the next interpolation from being the
 * one that forgets.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
