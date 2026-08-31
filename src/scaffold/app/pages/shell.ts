// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { escapeHtml } from '../email/html.js';
import {
  ACCENT,
  BODY_FONT,
  DIVIDER,
  HEADING_FONT,
  MONO_FONT,
  NEUTRAL_500,
  NEUTRAL_600,
  NEUTRAL_700,
} from '../email/tokens.js';

/**
 * The chrome every page a signed link opens
 * shares: the banner strip that explains what the
 * link is, and one centred column under it.
 *
 * The palette comes from the email tokens rather
 * than from a second copy here. The two surfaces
 * are the same product and a person who follows a
 * link out of one of these emails should land on
 * something that looks like where they came from.
 *
 * These pages are plain HTML with one stylesheet
 * and, on the form, one small script. Nothing is
 * fetched, nothing is bundled and there is no
 * framework: a page that renders a handful of
 * fields is not worth a build step, and a person
 * following a link from an email deserves to have
 * it open immediately.
 */

/**
 * The accent, tinted for a background and darkened
 * for text on it. Written out rather than mixed at
 * render time so the same two shades can be used
 * in an email, where mixing is not available.
 */
const ACCENT_TINT = '#eef2f7';
const ACCENT_TEXT = '#31506f';

const STYLE = `*{box-sizing:border-box}
body{margin:0;background:#fff;color:${NEUTRAL_700};
font:400 14px/1.6 ${BODY_FONT}}
.banner{background:${ACCENT_TINT};color:${ACCENT_TEXT};
font:400 11.5px/1.5 ${MONO_FONT};padding:9px 16px;text-align:center}
main{max-width:560px;margin:0 auto;padding:28px 20px 48px}
h1{font:600 28px/1.2 ${HEADING_FONT};margin:0;color:#1d1f20}
.lede{color:${NEUTRAL_600};margin:6px 0 0}
.centred{text-align:center}
.badge{display:inline-grid;place-items:center;width:30px;height:30px;
background:${ACCENT};color:#fff;font:600 15px ${HEADING_FONT}}
.field{margin-top:18px}
.label{font:400 10.5px ${MONO_FONT};letter-spacing:.08em;
text-transform:uppercase;color:${NEUTRAL_500};display:block}
input[type=text],textarea{width:100%;margin-top:6px;padding:9px 11px;
border:1px solid ${DIVIDER};font:inherit;color:inherit;background:#fff}
textarea{min-height:96px}
.drop{margin-top:6px;border:1px dashed ${ACCENT};background:${ACCENT_TINT};
padding:18px;text-align:center;color:${ACCENT_TEXT}}
.drop.off{border-color:${DIVIDER};background:#fff;color:${NEUTRAL_600}}
.choice{margin-top:6px;display:flex;gap:16px}
.note{color:${NEUTRAL_600};font-size:13px;margin:6px 0 0}
button{margin-top:24px;background:${ACCENT};color:#fff;border:0;
font:600 13px ${HEADING_FONT};letter-spacing:.05em;padding:11px 20px;
cursor:pointer}
.chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px;
justify-content:center;margin-top:18px;font:400 11px ${MONO_FONT}}
.chip{border:1px solid ${DIVIDER};padding:5px 9px;color:${NEUTRAL_600}}
.chip.now{border-color:${ACCENT};background:${ACCENT_TINT};
color:${ACCENT_TEXT}}
.arrow{color:${NEUTRAL_500}}
`;

export type Page = {
  /** What the browser tab says. */
  title: string;
  /** The strip above the column, or null on a
   *  page that is not about a signed link. */
  banner: string | null;
  body: string;
  /** Appended inside the document, after the
   *  body. Only the form page uses one. */
  script?: string;
};

export function renderPage(page: Page): string {
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escapeHtml(page.title)}</title>`,
    `<style>${STYLE}</style>`,
    `</head>`,
    `<body>`,
    page.banner === null
      ? ''
      : `<div class="banner">${escapeHtml(page.banner)}</div>`,
    `<main>`,
    page.body,
    `</main>`,
    page.script === undefined ? '' : `<script>${page.script}</script>`,
    `</body>`,
    `</html>`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * The banner every page opened by a form link
 * carries. It says in one line what this link is
 * and why there was no sign-in.
 */
export function linkBanner(recipient: string, runId: string): string {
  return (
    `secure form · personal signed link for ${recipient} — no sign-in ` +
    `exists · run ${runId} sleeps until you submit`
  );
}

/**
 * What the submit woke up: one pill per block that
 * runs after this wait, in the order they run, the
 * first marked as the one under way.
 *
 * Empty when the wait has nothing after it, and
 * then the caller renders nothing at all. Inventing
 * a fixed strip of plausible-looking steps would
 * be a lie in every app that copied it.
 */
export function chipStrip(titles: readonly string[]): string {
  if (titles.length === 0) return '';

  const pills = titles.map((title, index) =>
    index === 0
      ? `<span class="chip now">${escapeHtml(title)} ●</span>`
      : `<span class="chip">${escapeHtml(title)}</span>`,
  );

  const strip = pills.join('<span class="arrow">→</span>');

  return `<div class="chips">${strip}</div>`;
}
