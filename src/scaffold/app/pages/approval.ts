// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import type { WaitDescriptor } from '../contract.js';
import { escapeHtml } from '../email/html.js';

import { chipStrip, linkBanner, renderPage } from './shell.js';

/**
 * The approve-or-reject page, and what pressing
 * one of the two buttons lands on.
 *
 * An approval reuses the whole form mechanism: the
 * same signed link, the same verification, the
 * same wait. All that differs is that the page
 * asks one question with two answers instead of a
 * set of fields, which is why the wait descriptor
 * says which of the two pages a link opens.
 *
 * The copy here is mBoss's own, written to match
 * the form page rather than transcribed from a
 * design: the design describes this page in one
 * clause and pins none of its words.
 */

export type ApprovalPageInput = {
  appTitle: string;
  runId: string;
  recipient: string;
  action: string;
  wait: WaitDescriptor;
};

export function renderApprovalPage(input: ApprovalPageInput): string {
  const { appTitle, runId, recipient, action, wait } = input;

  return renderPage({
    title: `${appTitle} needs your decision`,
    banner: linkBanner(recipient, runId),
    body: [
      `<h1>${escapeHtml(appTitle)} needs your decision</h1>`,
      `<p class="lede">${escapeHtml(wait.title)}</p>`,
      `<form method="post" action="${escapeHtml(action)}">`,
      // Both buttons carry the same name. A form
      // sends only the submit button that was
      // pressed, so the answer arrives complete
      // and there is no unset third state to
      // handle.
      `<div class="choice">`,
      `<button type="submit" name="decision" value="approve">Approve` +
        `</button>`,
      `<button type="submit" name="decision" value="reject">Reject</button>`,
      `</div>`,
      `</form>`,
    ].join('\n'),
  });
}

export type ApprovalDoneInput = {
  appTitle: string;
  runId: string;
  approved: boolean;
  /** The blocks that run next, whichever way the
   *  decision went. */
  downstream: readonly string[];
};

/**
 * What a decision lands on.
 *
 * The badge is the same accent check either way:
 * it confirms that the answer landed, not that the
 * answer was yes.
 */
export function renderApprovalDonePage(input: ApprovalDoneInput): string {
  const answer = input.approved ? 'approved' : 'rejected';

  return renderPage({
    title: 'Got it — decision recorded.',
    banner: null,
    body: [
      `<div class="centred">`,
      `<span class="badge">✓</span>`,
      `<h1>Got it — decision recorded.</h1>`,
      `<p class="lede">Run ${escapeHtml(input.runId)} woke up with your ` +
        `answer: ${answer}. You can close this tab.</p>`,
      chipStrip(input.downstream),
      `</div>`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  });
}
