import { describe, expect, it } from 'vitest';

import { renderBroadcastEmail } from './broadcast.js';

const SUBJECT = 'Progress update #3 — the canvas is alive';

const BODY_MARKDOWN = [
  '# The canvas is alive.',
  '',
  'First look at the mBoss canvas: workflows drawn as blocks, compiled',
  'straight to durable DBOS code.',
  '',
  '```',
  "this week's build —",
  'canvas → codegen 412 ms · tsc clean',
  'kill -9 mid-run → resumed from postgres · 0 steps re-run',
  '```',
  '',
  '[Watch the 40-second clip](https://mboss.dev/clip)',
].join('\n');

const LINKS = {
  manageUrl: 'https://mboss.dev/u/tok-1',
  unsubscribeUrl: 'https://mboss.dev/api/unsubscribe/tok-1',
};

const full = renderBroadcastEmail({
  to: 'pat@stmarks.org',
  subject: SUBJECT,
  bodyMarkdown: BODY_MARKDOWN,
  teaserImageUrl: 'https://mboss.dev/teaser.png',
  links: LINKS,
});

const minimal = renderBroadcastEmail({
  to: 'pat@stmarks.org',
  subject: SUBJECT,
  bodyMarkdown: 'A short note with nothing but a paragraph in it.',
  teaserImageUrl: null,
  links: LINKS,
});

const withoutLinks = renderBroadcastEmail({
  to: 'someone@example.com',
  subject: SUBJECT,
  bodyMarkdown: 'A short note with nothing but a paragraph in it.',
  teaserImageUrl: null,
  links: null,
});

describe('renderBroadcastEmail', () => {
  it('takes the subject verbatim', () => {
    expect(full.subject).toBe(SUBJECT);
    expect(full.to).toBe('pat@stmarks.org');
  });

  it('renders the body markdown into the card', () => {
    expect(full.html).toContain('>The canvas is alive.</div>');
    expect(full.html).toContain('First look at the mBoss canvas');
    expect(full.html).toContain("this week's build —<br>");
    expect(full.html).toContain('>Watch the 40-second clip</a>');
  });

  it('places the teaser image under the body', () => {
    expect(full.html).toContain(
      '<img src="https://mboss.dev/teaser.png" alt="" ' +
        'style="max-width:100%;display:block;margin-top:14px">',
    );
    expect(minimal.html).not.toContain('<img');
  });

  it('escapes the teaser image URL into the src attribute', () => {
    // The URL is admin-supplied and the schema
    // that carries it validates without altering
    // it, so a quote in it would end the attribute
    // and start another one. A bare `&` is the
    // everyday case: every signed or sized CDN URL
    // has one.
    const message = renderBroadcastEmail({
      to: 'pat@stmarks.org',
      subject: SUBJECT,
      bodyMarkdown: 'A short note.',
      teaserImageUrl: 'https://cdn.test/t.png?w=800&sig=a"b',
      links: null,
    });

    expect(message.html).toContain(
      '<img src="https://cdn.test/t.png?w=800&amp;sig=a&quot;b"',
    );
    expect(message.html).not.toContain('sig=a"b"');
  });

  it('carries the broadcast footer copy verbatim', () => {
    expect(full.html).toContain(
      "no action needed · we'll email again when there's something you " +
        'can install · pause or unsubscribe below',
    );
    expect(full.html).toContain('mBoss · Seattle, WA ·');
  });

  it('points the footer unsubscribe at the manage link', () => {
    expect(full.html).toContain('<a href="https://mboss.dev/u/tok-1"');
    expect(full.html).toContain('>unsubscribe</a>');
  });

  it('carries the one-click unsubscribe headers', () => {
    // Spelled out rather than snapshotted: these
    // two values are the compliance contract, and
    // a snapshot can be blessed wrong and stay
    // wrong.
    expect(full.headers).toEqual({
      'List-Unsubscribe':
        '<https://mboss.dev/api/unsubscribe/tok-1>, ' +
        '<mailto:unsubscribe@mboss.dev>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  /**
   * Three shapes, because they differ in the card
   * rather than in one line of it: everything the
   * Markdown renderer can produce, the plainest
   * possible note, and the test-send shape with
   * no manage link. `.html` so they can be opened
   * and looked at.
   */
  it.each([
    ['full', full],
    ['minimal', minimal],
    ['no-links', withoutLinks],
  ])('renders the %s card', async (name, message) => {
    await expect(message.html).toMatchFileSnapshot(
      `./__snapshots__/broadcast-${name}.html`,
    );
  });

  it('omits the headers and the footer link when there are no links', () => {
    expect(withoutLinks.headers).toBeUndefined();
    expect(withoutLinks.html).not.toContain('<a href');
    expect(withoutLinks.html).toContain('mBoss · Seattle, WA · unsubscribe');
  });
});
