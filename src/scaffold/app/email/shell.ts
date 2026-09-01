// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import { escapeHtml } from './html.js';
import {
  ACCENT,
  DIVIDER,
  HEADING_FONT,
  MONO_FONT,
  NEUTRAL_100,
  NEUTRAL_500,
} from './tokens.js';

/**
 * The card every email this app sends arrives in.
 *
 * It is the same card mBoss's own emails use — a
 * grey page, a white card with a hairline border,
 * the logo row, a mono strip above the divider —
 * and it is the one file in this directory that is
 * not a copy of mBoss's. Theirs hardcodes the
 * mBoss wordmark and a fixed context tag, and this
 * one has to carry your app's name and the run the
 * message is about. Everything else here is copied
 * verbatim so the two stay recognisably the same
 * card.
 *
 * Everything is a `div` with inline styles,
 * because that is all an email client can be
 * relied on to read.
 */

export type AppShell = {
  /** The name people see: yours, not mBoss's. */
  appTitle: string;
  /** The run this message is about. */
  runId: string;
  /** The rendered content between the logo row
   *  and the strip. */
  body: string;
  /** The mono line above the divider. */
  note: string;
};

export function renderAppShell(shell: AppShell): string {
  // Broken across lines between block elements:
  // an email client ignores the whitespace, and
  // it makes the rendered markup reviewable.
  return [
    `<!doctype html>`,
    `<html><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `</head>`,
    `<body style="margin:0;background:${NEUTRAL_100}">`,
    `<div style="background:${NEUTRAL_100};padding:24px">`,
    `<div style="background:#fff;border:1px solid ${DIVIDER};` +
      `max-width:440px;margin:0 auto;padding:22px 24px">`,
    logoRow(shell.appTitle, shell.runId),
    shell.body,
    footerNote(shell.note),
    `</div>`,
    sentBy(shell.appTitle),
    `</div></body></html>`,
  ].join('\n');
}

function logoRow(appTitle: string, runId: string): string {
  return (
    `<div style="display:flex;align-items:center;gap:8px">` +
    `<span style="width:18px;height:18px;background:${ACCENT};` +
    `display:grid;place-items:center;font:600 11px ${HEADING_FONT};` +
    `color:#fff">m</span>` +
    `<span style="font:600 15px ${HEADING_FONT}">` +
    `${escapeHtml(appTitle)}</span>` +
    `<span style="margin-left:auto;font:400 9.5px ${MONO_FONT};` +
    `color:${NEUTRAL_500}">run ${escapeHtml(runId)}</span>` +
    `</div>`
  );
}

function footerNote(note: string): string {
  return (
    `<div style="font:400 10.5px ${MONO_FONT};color:${NEUTRAL_500};` +
    `margin-top:14px;border-top:1px solid ${DIVIDER};padding-top:10px">` +
    `${note}</div>`
  );
}

/**
 * The line outside the card. It names the two
 * settings that produced the message, because the
 * person most likely to read it closely is the
 * owner of the app wondering where it came from.
 */
function sentBy(appTitle: string): string {
  return (
    `<div style="text-align:center;font:400 9.5px ${MONO_FONT};` +
    `color:${NEUTRAL_500};margin-top:10px">` +
    `sent by your ${escapeHtml(appTitle)} app ` +
    `(MAIL_FROM, your Twilio Email key) · built with mBoss</div>`
  );
}
