import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('escapes HTML in the source', () => {
    const html = renderMarkdown('<script>alert("x")</script> & co');

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('&amp; co');
    expect(html).not.toContain('<script>');
  });

  it('renders a leading heading at the headline style', () => {
    const html = renderMarkdown('# The canvas is alive.');

    expect(html).toContain(
      `<div style="font:600 22px 'Barlow Condensed', system-ui, sans-serif;` +
        `margin-top:16px">The canvas is alive.</div>`,
    );
  });

  it('renders blank-line-separated blocks as paragraphs', () => {
    const html = renderMarkdown('First para.\nsame para.\n\nSecond para.');

    expect(html).toContain('First para. same para.</div>');
    expect(html).toContain('Second para.</div>');
    expect(html).toContain('color:#5d5d60');
  });

  it('renders a fenced block as the mono strip', () => {
    const html = renderMarkdown(
      "```\nthis week's build —\ncanvas → codegen 412 ms\n```",
    );

    expect(html).toContain('background:#f5f5f8');
    expect(html).toContain(
      "this week's build —<br>canvas → codegen 412 ms</div>",
    );
  });

  it('renders a paragraph that is nothing but a link as the button', () => {
    const html = renderMarkdown(
      '[Watch the 40-second clip](https://mboss.dev/clip)',
    );

    expect(html).toContain('<div style="text-align:center;margin-top:16px">');
    expect(html).toContain('background:#5980a6');
    expect(html).toContain('>Watch the 40-second clip</a>');
    expect(html).toContain('href="https://mboss.dev/clip"');
  });

  it('renders a link inside a sentence inline', () => {
    const html = renderMarkdown('See [the clip](https://mboss.dev/clip) now.');

    expect(html).toContain(
      'See <a href="https://mboss.dev/clip" style="color:#5980a6">' +
        'the clip</a> now.',
    );
    // The button rule is about a paragraph that is
    // nothing else; an ordinary link must not
    // trigger it.
    expect(html).not.toContain('text-align:center');
  });

  it('renders bold and italic', () => {
    const html = renderMarkdown('A **bold** and an *italic* word.');

    expect(html).toContain(
      'A <strong>bold</strong> and an <em>italic</em> word.',
    );
  });

  it('leaves unsupported syntax as escaped text', () => {
    const html = renderMarkdown('> quoted\n\n| a | b |\n| - | - |');

    expect(html).toContain('&gt; quoted');
    expect(html).toContain('| a | b | | - | - |');
    expect(html).not.toContain('<blockquote');
    expect(html).not.toContain('<table');
  });

  it('leaves emphasis characters inside a URL alone', () => {
    const html = renderMarkdown('See [docs](https://mboss.dev/a*b*c) now.');

    expect(html).toContain('href="https://mboss.dev/a*b*c"');
  });
});
