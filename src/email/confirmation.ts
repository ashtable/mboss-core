import type { EmailMessage } from './message.js';
import { renderShell } from './shell.js';
import { BODY_FONT, HEADING_FONT, NEUTRAL_700 } from './tokens.js';

/**
 * The waitlist confirmation. Every word of it is
 * fixed: the only thing that varies between two
 * of these emails is who it goes to and which
 * manage link it carries, so there is nothing
 * here to compose and nothing to template.
 */

const SUBJECT = "You're on the mBoss waitlist";
const HEADLINE = "You're on the list.";
const BODY =
  'Thanks for your interest — mBoss is in its very early days. This list ' +
  "is how we'll keep you posted: short notes as features start working, " +
  'and a heads-up the day you can try the extension.';
const NOTE = 'while you wait: github.com/ashtable/mboss · mboss.dev/docs';

export function renderConfirmationEmail(input: {
  to: string;
  manageUrl: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: SUBJECT,
    html: renderShell({
      body: [
        `<div style="font:600 22px ${HEADING_FONT};margin-top:16px">` +
          `${HEADLINE}</div>`,
        `<div style="font:400 12.5px/1.6 ${BODY_FONT};` +
          `color:${NEUTRAL_700};margin-top:8px">${BODY}</div>`,
      ].join('\n'),
      note: NOTE,
      manageUrl: input.manageUrl,
    }),
  };
}
