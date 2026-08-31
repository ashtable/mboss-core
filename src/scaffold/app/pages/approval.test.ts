import { describe, expect, it } from 'vitest';

import type { WaitDescriptor } from '../contract.js';

import { renderApprovalDonePage, renderApprovalPage } from './approval.js';

/**
 * The approve-or-reject page and what a decision
 * lands on.
 *
 * No mockup exists for either of these — the
 * design describes them in one clause, "a minimal
 * approve/reject page, two buttons, same
 * signed-link verification". The copy below is
 * authored here, following the form page's
 * conventions: the same banner, the same shell,
 * the same closing sentence. A later reader should
 * not go looking for a mockup to diff it against.
 */

const WAIT: WaitDescriptor = {
  nodeId: 'manager_ok',
  title: 'Manager sign-off',
  page: 'approval',
  fields: [],
  downstream: ['Pay the invoice'],
};

const page = renderApprovalPage({
  appTitle: 'Expenses',
  runId: 'wf_44a1',
  recipient: 'ops@example.com',
  action: '/f/tok-approval',
  wait: WAIT,
});

describe('the approve or reject page', () => {
  it('carries the same banner as the form page', () => {
    expect(page).toContain(
      'secure form · personal signed link for ops@example.com — no ' +
        'sign-in exists · run wf_44a1 sleeps until you submit',
    );
  });

  it('says what is being decided', () => {
    expect(page).toContain('Expenses needs your decision');
    expect(page).toContain('Manager sign-off');
  });

  it('offers exactly two buttons, and says which is which', () => {
    expect(page).toContain('value="approve"');
    expect(page).toContain('value="reject"');
    expect(page).toContain('>Approve<');
    expect(page).toContain('>Reject<');
  });

  it('posts both of them back to the link that opened it', () => {
    expect(page).toContain('action="/f/tok-approval"');
    expect(page).toContain('method="post"');
  });

  it('sends both buttons under one name, so the answer is unambiguous', () => {
    // Two submit buttons in one form send only the
    // one that was pressed, which is what makes
    // the decision readable without a radio group
    // somebody could leave unset.
    expect(page.match(/name="decision"/g)).toHaveLength(2);
  });

  it('renders the page', async () => {
    await expect(page).toMatchFileSnapshot('./__snapshots__/approval.html');
  });
});

describe('the page a decision lands on', () => {
  const approved = renderApprovalDonePage({
    appTitle: 'Expenses',
    runId: 'wf_44a1',
    approved: true,
    downstream: ['Pay the invoice'],
  });

  it('repeats the decision back, so nobody has to remember it', () => {
    expect(approved).toContain('Got it — decision recorded.');
    expect(approved).toContain(
      'Run wf_44a1 woke up with your answer: approved.',
    );
  });

  it('shows what that decision woke up', () => {
    expect(approved).toContain('Pay the invoice ●');
  });

  it('says the other answer when the other button was pressed', () => {
    const rejected = renderApprovalDonePage({
      appTitle: 'Expenses',
      runId: 'wf_44a1',
      approved: false,
      downstream: [],
    });

    expect(rejected).toContain(
      'Run wf_44a1 woke up with your answer: rejected.',
    );
  });

  it('renders the page', async () => {
    await expect(approved).toMatchFileSnapshot(
      './__snapshots__/approval-done.html',
    );
  });
});
