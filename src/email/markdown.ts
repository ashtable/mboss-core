import { escapeHtml } from './html.js';
import {
  ACCENT,
  BODY_FONT,
  DIVIDER,
  HEADING_FONT,
  MONO_FONT,
  NEUTRAL_100,
  NEUTRAL_600,
  NEUTRAL_700,
} from './tokens.js';

/**
 * The small slice of Markdown a broadcast body is
 * written in, rendered straight to email HTML.
 *
 * It is hand-written rather than delegated to a
 * Markdown library because email needs an inline
 * style on every element: a library's output
 * would have to be post-processed element by
 * element, which is more code than producing the
 * markup directly, and less obvious about what
 * the result looks like.
 *
 * Four block shapes carry the whole design. A
 * heading line is the 22px headline. A fenced
 * block is the bordered mono strip. A paragraph
 * that is nothing but one link is the CTA button.
 * Everything else is body copy. Syntax outside
 * that set — tables, blockquotes, lists — is left
 * as the literal text the author typed rather
 * than half-rendered.
 */

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lines: string[] };

const HEADING = /^ {0,3}#{1,2} +(.*)$/;
const FENCE = /^ {0,3}```/;
/** A whole paragraph that is one Markdown link. */
const LONE_LINK = /^\[([^\]]*)\]\(([^)\s]+)\)$/;
const INLINE_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/;

export function renderMarkdown(source: string): string {
  return parseBlocks(source).map(renderBlock).join('\n');
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (FENCE.test(line)) {
      flush();
      const fenced: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        fenced.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'code', lines: fenced });
      continue;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1]?.trim() ?? '' });
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return (
        `<div style="font:600 22px ${HEADING_FONT};margin-top:16px">` +
        `${renderInline(block.text)}</div>`
      );
    case 'code':
      return (
        `<div style="border:1px solid ${DIVIDER};background:${NEUTRAL_100};` +
        `margin-top:10px;padding:9px 11px;font:400 9.5px/1.9 ${MONO_FONT};` +
        `color:${NEUTRAL_600}">` +
        `${block.lines.map(escapeHtml).join('<br>')}</div>`
      );
    case 'paragraph': {
      const button = LONE_LINK.exec(block.text);
      if (button) return renderButton(button[2] ?? '', button[1] ?? '');
      return (
        `<div style="font:400 12.5px/1.6 ${BODY_FONT};color:${NEUTRAL_700};` +
        `margin-top:8px">${renderInline(block.text)}</div>`
      );
    }
  }
}

function renderButton(href: string, label: string): string {
  return (
    `<div style="text-align:center;margin-top:16px">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;` +
    `background:${ACCENT};color:#fff;font:600 12.5px ${HEADING_FONT};` +
    `letter-spacing:.05em;padding:9px 18px;text-decoration:none">` +
    `${escapeHtml(label)}</a></div>`
  );
}

/**
 * Emphasis is applied to the text around links
 * rather than to the whole string, so an
 * underscore or an asterisk inside a URL stays
 * part of the URL.
 */
function renderInline(text: string): string {
  let rest = escapeHtml(text);
  let html = '';

  for (;;) {
    const link = INLINE_LINK.exec(rest);
    if (!link) break;
    html +=
      emphasis(rest.slice(0, link.index)) +
      `<a href="${link[2] ?? ''}" style="color:${ACCENT}">` +
      `${emphasis(link[1] ?? '')}</a>`;
    rest = rest.slice(link.index + link[0].length);
  }

  return html + emphasis(rest);
}

// Bold before italic, or the italic rule eats the
// first two asterisks of a bold run.
function emphasis(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
