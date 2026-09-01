import { describe, expect, it } from 'vitest';

import { renderAppShell } from './shell.js';

/**
 * The card every email a generated app sends
 * arrives in.
 *
 * It is the one piece of the email layer that is
 * not a byte-copy of mBoss's own, so it is the one
 * piece with its own tests: mBoss's shell puts the
 * mBoss wordmark and "private beta" in the logo
 * row, and a generated app has to put its own name
 * and the run the mail is about.
 */

const html = renderAppShell({
  appTitle: 'Sermon Helper',
  runId: 'wf_81c2',
  body: '<div>the body goes here</div>',
  note: 'a note under the divider',
});

describe('the app email shell', () => {
  it('is a whole document, so a client has something to open', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('puts the app name where mBoss puts its own', () => {
    expect(html).toContain('Sermon Helper');
    expect(html).not.toContain('>mBoss<');
  });

  it('tags the card with the run it is about', () => {
    expect(html).toContain('run wf_81c2');
    expect(html).not.toContain('private beta');
  });

  it('carries the body and the note it was given', () => {
    expect(html).toContain('<div>the body goes here</div>');
    expect(html).toContain('a note under the divider');
  });

  it('says who sent it, and with what, outside the card', () => {
    // The literal MAIL_FROM is deliberate: the
    // line tells the owner which of their own
    // settings produced the mail, and the address
    // itself is already in the From header.
    expect(html).toContain(
      'sent by your Sermon Helper app (MAIL_FROM, your Twilio Email key) · ' +
        'built with mBoss',
    );
  });

  it('escapes an app name, which is a person-supplied string', () => {
    const escaped = renderAppShell({
      appTitle: '<script>alert(1)</script>',
      runId: 'wf_1',
      body: '',
      note: '',
    });

    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('escapes a run id too', () => {
    const escaped = renderAppShell({
      appTitle: 'App',
      runId: '"><script>',
      body: '',
      note: '',
    });

    expect(escaped).not.toContain('"><script>');
  });

  /**
   * The assertions above are the specification;
   * this locks the rest of the card. It is a
   * `.html` file so it can be opened and looked
   * at, which is the only way to review an email.
   */
  it('renders the card', async () => {
    await expect(html).toMatchFileSnapshot('./__snapshots__/shell.html');
  });
});
