// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import type { EmailFormField, NodeEmail } from '../contract.js';

import { escapeHtml } from './html.js';
import { renderMarkdown } from './markdown.js';
import type { EmailMessage } from './message.js';
import { renderAppShell } from './shell.js';
import { ACCENT, BODY_FONT, HEADING_FONT, NEUTRAL_700 } from './tokens.js';

/**
 * One email per workflow node that sends one.
 *
 * The subject and the body belong to whoever drew
 * the workflow; everything around them is fixed so
 * that two apps built with mBoss send recognisably
 * the same mail. The four shapes below are the
 * four things a node can attach: a form to fill
 * in, a decision to make, a file to read, or
 * nothing at all.
 *
 * The link is minted by the caller rather than
 * here, because minting reads the clock and this
 * has to be a pure function of its inputs.
 */

/** A day, in seconds. */
const DAY = 86400;

const FORM_INTRO =
  'Your workflow started and is waiting on you. Open your secure form to:';

const FORM_NOTE =
  'personal signed link — the link itself is the credential, no account ' +
  'needed · the run sleeps in Postgres until you submit — no rush';

const ARTIFACT_NOTE =
  'personal signed link — the link itself is the credential, no account ' +
  'needed';

const PLAIN_NOTE =
  'sent by a workflow in your app · there is nothing to open in this one';

export type NodeEmailRender = {
  email: NodeEmail;
  /** The name people see on the card. */
  appTitle: string;
  /** Where the button goes, already minted, or
   *  null when the message attaches nothing. */
  linkUrl: string | null;
};

export function renderNodeEmail(input: NodeEmailRender): EmailMessage {
  const { email, appTitle, linkUrl } = input;
  const body = [renderMarkdown(email.bodyMarkdown)];

  if (email.attach.kind === 'form') {
    body.push(paragraph(FORM_INTRO), bullets(email.attach.fields));
  }
  if (linkUrl !== null) body.push(button(linkUrl, ctaLabel(email)));

  return {
    to: email.to,
    subject: email.subject,
    html: renderAppShell({
      appTitle,
      runId: email.runId,
      body: body.join('\n'),
      note: noteFor(email),
    }),
  };
}

/**
 * What one form field asks of the person reading
 * the email, in a sentence.
 *
 * The field's own label is what it is called on
 * the page; a bullet that only repeated it would
 * say "Documents" and leave the reader to guess
 * what to do with them. A yes-or-no question keeps
 * its capitalisation, because it is already a
 * sentence and lowercasing it would read as a
 * mistake.
 */
export function describeField(field: EmailFormField): string {
  const suffix = field.required ? '' : ' (optional)';
  const label = field.label.toLowerCase();

  switch (field.type) {
    case 'fileUpload':
      return field.multiple
        ? `upload one or more documents${suffix}`
        : `upload a document${suffix}`;
    case 'textarea':
      return `tell it ${label}${suffix}`;
    case 'yesNo':
      return `answer: ${field.label}${suffix}`;
    case 'text':
      return `give it ${label}${suffix}`;
  }
}

function ctaLabel(email: NodeEmail): string {
  switch (email.attach.kind) {
    case 'form':
      return 'Open your secure form';
    case 'approval':
      // Nothing in the design names this one. The
      // form label describes the wrong action for
      // a decision, so this is authored here, the
      // same way the approve and reject page is.
      return 'Review and decide';
    case 'artifact':
      return 'Read the full draft';
    case 'none':
      return '';
  }
}

/**
 * The mono strip under the divider. It explains
 * the link, so it changes with the link: a message
 * carrying nothing to open cannot claim to carry a
 * credential.
 */
function noteFor(email: NodeEmail): string {
  switch (email.attach.kind) {
    case 'form':
    case 'approval':
      return FORM_NOTE;
    case 'artifact':
      return `${ARTIFACT_NOTE} · this link expires in ${expiresIn(
        email.attach.expiresInSeconds,
      )}`;
    case 'none':
      return PLAIN_NOTE;
  }
}

/**
 * How long a link lasts, in days, because every
 * link this app mints lasts days rather than
 * minutes. Rounded to at least one, so a short
 * link says something rather than "0 days".
 */
function expiresIn(seconds: number): string {
  const days = Math.max(1, Math.round(seconds / DAY));

  return days === 1 ? '1 day' : `${days} days`;
}

function paragraph(text: string): string {
  return (
    `<div style="font:400 12.5px/1.6 ${BODY_FONT};color:${NEUTRAL_700};` +
    `margin-top:8px">${escapeHtml(text)}</div>`
  );
}

function bullets(fields: readonly EmailFormField[]): string {
  const lines = fields
    .map((field) => `· ${escapeHtml(describeField(field))}`)
    .join('<br>');

  return (
    `<div style="font:400 12.5px/1.6 ${BODY_FONT};color:${NEUTRAL_700};` +
    `margin-top:8px">${lines}</div>`
  );
}

/**
 * The one button. It repeats the markup mBoss's
 * Markdown renderer uses for a link-only
 * paragraph, rather than reaching into it: that
 * file is a byte-for-byte copy of mBoss's own and
 * exports one function, so the choice is between
 * these eight lines and editing a file whose whole
 * value is that it has not been edited.
 */
function button(href: string, label: string): string {
  return (
    `<div style="text-align:center;margin-top:16px">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;` +
    `background:${ACCENT};color:#fff;font:600 12.5px ${HEADING_FONT};` +
    `letter-spacing:.05em;padding:9px 18px;text-decoration:none">` +
    `${escapeHtml(label)}</a></div>`
  );
}
