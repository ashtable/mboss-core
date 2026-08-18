import { describe, expect, it } from 'vitest';

import { renderConfirmationEmail } from './confirmation.js';

const message = renderConfirmationEmail({
  to: 'pat@stmarks.org',
  manageUrl: 'https://mboss.dev/u/tok-1',
});

describe('renderConfirmationEmail', () => {
  it('sends to the subscriber under the fixed subject', () => {
    expect(message.to).toBe('pat@stmarks.org');
    expect(message.subject).toBe("You're on the mBoss waitlist");
  });

  it('carries the confirmation copy verbatim', () => {
    expect(message.html).toContain('private beta');
    expect(message.html).toContain("You're on the list.");
    expect(message.html).toContain(
      'Thanks for your interest — mBoss is in its very early days. This ' +
        "list is how we'll keep you posted: short notes as features start " +
        'working, and a heads-up the day you can try the extension.',
    );
    expect(message.html).toContain(
      'while you wait: github.com/ashtable/mboss · mboss.dev/docs',
    );
    expect(message.html).toContain('mBoss · Seattle, WA ·');
  });

  it('points the footer unsubscribe at the manage link', () => {
    expect(message.html).toContain('<a href="https://mboss.dev/u/tok-1"');
    expect(message.html).toContain('>unsubscribe</a>');
  });

  /**
   * The assertions above are the spec; this locks
   * the rest of the card against an accidental
   * edit. It is a `.html` file so it can be
   * opened and looked at, which is the only way
   * to review an email.
   */
  it('renders the card', async () => {
    await expect(message.html).toMatchFileSnapshot(
      './__snapshots__/confirmation.html',
    );
  });

  it('carries no unsubscribe headers', () => {
    // The one-click headers are a bulk-mail
    // mechanism. This is one person's receipt for
    // one action they just took, and the manage
    // link in the footer is the way out of it.
    expect(message.headers).toBeUndefined();
  });
});
