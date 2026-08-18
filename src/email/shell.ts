import {
  ACCENT,
  DIVIDER,
  HEADING_FONT,
  MONO_FONT,
  NEUTRAL_100,
  NEUTRAL_500,
} from './tokens.js';

/**
 * The card both emails arrive in: a grey page, a
 * white 440px card with a hairline border, the
 * logo row with its accent square and context
 * tag, a mono strip above the divider, and the
 * address line outside the card.
 *
 * Everything is a `div` with inline styles,
 * because that is all an email client can be
 * relied on to read. The flex logo row is the one
 * modern-CSS construct here; where it is not
 * supported the three pieces stack, which is
 * legible.
 */

export type Shell = {
  /** The rendered content between logo row and strip. */
  body: string;
  /** The mono line above the divider. */
  note: string;
  /**
   * Where the address line's "unsubscribe" points.
   * Null renders it as plain text — a test send
   * has no subscriber behind it, so there is no
   * token that could ever verify.
   */
  manageUrl: string | null;
};

export function renderShell(shell: Shell): string {
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
    logoRow(),
    shell.body,
    footerNote(shell.note),
    `</div>`,
    addressLine(shell.manageUrl),
    `</div></body></html>`,
  ].join('\n');
}

function logoRow(): string {
  return (
    `<div style="display:flex;align-items:center;gap:8px">` +
    `<span style="width:18px;height:18px;background:${ACCENT};` +
    `display:grid;place-items:center;font:600 11px ${HEADING_FONT};` +
    `color:#fff">m</span>` +
    `<span style="font:600 15px ${HEADING_FONT}">mBoss</span>` +
    `<span style="margin-left:auto;font:400 9.5px ${MONO_FONT};` +
    `color:${NEUTRAL_500}">private beta</span>` +
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

function addressLine(manageUrl: string | null): string {
  const unsubscribe =
    manageUrl === null
      ? 'unsubscribe'
      : `<a href="${manageUrl}" style="color:${NEUTRAL_500}">unsubscribe</a>`;

  return (
    `<div style="text-align:center;font:400 9.5px ${MONO_FONT};` +
    `color:${NEUTRAL_500};margin-top:10px">` +
    `mBoss · Seattle, WA · ${unsubscribe}</div>`
  );
}
