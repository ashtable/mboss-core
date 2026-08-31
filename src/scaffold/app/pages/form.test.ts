import { describe, expect, it } from 'vitest';

import type { EmailFormField, WaitDescriptor } from '../contract.js';

import {
  renderFormPage,
  renderInvalidPage,
  renderResolvedPage,
  renderSubmittedPage,
} from './form.js';

/**
 * The pages a signed form link opens.
 *
 * Every sentence a person reads here is fixed
 * mBoss copy, so each one is asserted on its own
 * before the snapshot locks the rest of the page.
 * The snapshots are `.html` files so they can be
 * opened in a browser, which is the only way to
 * review a page.
 */

const FIELDS: EmailFormField[] = [
  {
    id: 'docs',
    label: 'Documents',
    type: 'fileUpload',
    required: true,
    multiple: true,
  },
  {
    id: 'request',
    label: 'Your request',
    type: 'textarea',
    required: true,
    multiple: false,
  },
  {
    id: 'reference',
    label: 'Reference number',
    type: 'text',
    required: false,
    multiple: false,
  },
  {
    id: 'urgent',
    label: 'Is this urgent?',
    type: 'yesNo',
    required: true,
    multiple: false,
  },
];

const WAIT: WaitDescriptor = {
  nodeId: 'await_form',
  title: 'Collect the sermon notes',
  page: 'form',
  fields: FIELDS,
  downstream: ['Draft the sermon', 'Email the draft'],
};

/**
 * One field's block of markup, from its marker to
 * the next field's. Assertions about one field
 * then cannot be satisfied by its neighbour.
 */
function fieldBlock(html: string, id: string): string {
  const start = html.indexOf(`data-field="${id}"`);
  const next = html.indexOf('data-field="', start + 1);

  return html.slice(start, next === -1 ? undefined : next);
}

const page = renderFormPage({
  appTitle: 'Sermon Helper',
  runId: 'wf_81c2',
  recipient: 'sam@hillsong.io',
  action: '/f/tok-form',
  wait: WAIT,
  uploadsEnabled: true,
});

describe('the form page', () => {
  it('is a whole document a browser can open', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('carries the banner that explains the link', () => {
    expect(page).toContain(
      'secure form · personal signed link for sam@hillsong.io — no ' +
        'sign-in exists · run wf_81c2 sleeps until you submit',
    );
  });

  it('says which app is asking', () => {
    expect(page).toContain('Sermon Helper needs your input');
  });

  it('says what this particular wait is for', () => {
    expect(page).toContain('Collect the sermon notes');
  });

  it('posts back to the link that opened it', () => {
    expect(page).toContain('action="/f/tok-form"');
    expect(page).toContain('method="post"');
  });

  it('accepts files, so the form has to be multipart', () => {
    expect(page).toContain('enctype="multipart/form-data"');
  });

  it('renders one control per field, named by its id', () => {
    expect(page).toContain('name="docs"');
    expect(page).toContain('name="request"');
    expect(page).toContain('name="reference"');
    expect(page).toContain('name="urgent"');
  });

  it('offers both answers to a yes-or-no question', () => {
    expect(page).toContain('value="yes"');
    expect(page).toContain('value="no"');
  });

  it('marks the required fields required and leaves the others alone', () => {
    expect(fieldBlock(page, 'request')).toContain('required');
    expect(fieldBlock(page, 'reference')).not.toContain('required');
  });

  it('labels the button with what pressing it does', () => {
    expect(page).toContain('Submit &amp; resume the workflow');
  });

  it('escapes a label, which is a person-supplied string', () => {
    const nasty = renderFormPage({
      appTitle: 'App',
      runId: 'wf_1',
      recipient: 'a@b.c',
      action: '/f/t',
      wait: {
        ...WAIT,
        fields: [
          {
            id: 'x',
            label: '<script>alert(1)</script>',
            type: 'text',
            required: true,
            multiple: false,
          },
        ],
      },
      uploadsEnabled: true,
    });

    expect(nasty).not.toContain('<script>alert(1)</script>');
    expect(nasty).toContain('&lt;script&gt;');
  });

  it('renders the page', async () => {
    await expect(page).toMatchFileSnapshot('./__snapshots__/form.html');
  });
});

describe('a form with no object store behind it', () => {
  const disabled = renderFormPage({
    appTitle: 'Sermon Helper',
    runId: 'wf_81c2',
    recipient: 'sam@hillsong.io',
    action: '/f/tok-form',
    wait: { ...WAIT, fields: [FIELDS[0] as EmailFormField] },
    uploadsEnabled: false,
  });

  it('disables the dropzone rather than dropping the file quietly', () => {
    expect(fieldBlock(disabled, 'docs')).toContain('disabled');
    expect(fieldBlock(page, 'docs')).not.toContain('disabled');
  });

  it('says plainly why, in one sentence', () => {
    expect(disabled).toContain(
      'File uploads are switched off: this app has no object store ' +
        'configured.',
    );
  });

  it('does not ask a browser to post a file it cannot take', () => {
    expect(disabled).not.toContain('enctype="multipart/form-data"');
  });

  it('renders the page', async () => {
    await expect(disabled).toMatchFileSnapshot(
      './__snapshots__/form-no-store.html',
    );
  });
});

describe('a form with a field that depends on another', () => {
  const conditional = renderFormPage({
    appTitle: 'Sermon Helper',
    runId: 'wf_81c2',
    recipient: 'sam@hillsong.io',
    action: '/f/tok-form',
    wait: {
      ...WAIT,
      fields: [
        FIELDS[3] as EmailFormField,
        {
          id: 'deadline',
          label: 'When do you need it?',
          type: 'text',
          required: false,
          multiple: false,
          showIf: { fieldId: 'urgent', op: 'eq', value: true },
        },
      ],
    },
    uploadsEnabled: true,
  });

  it('carries the condition as data the page can read', () => {
    expect(conditional).toContain('data-show-if=');
    expect(conditional).toContain('&quot;fieldId&quot;:&quot;urgent&quot;');
  });

  it('shows the field in the markup, so scripting off shows everything', () => {
    // Hiding in the markup and revealing with a
    // script fails the other way: a browser with
    // no scripting would hide a required field and
    // the form could never be submitted.
    const marked = conditional.slice(conditional.indexOf('data-show-if='));

    expect(marked).not.toContain('style="display:none"');
  });

  it('renders the page', async () => {
    await expect(conditional).toMatchFileSnapshot(
      './__snapshots__/form-conditional.html',
    );
  });
});

const submitted = renderSubmittedPage({
  appTitle: 'Sermon Helper',
  runId: 'wf_81c2',
  downstream: ['Draft the sermon', 'Email the draft'],
});

describe('the page a submit lands on', () => {
  it('carries the fixed headline', () => {
    expect(submitted).toContain('Got it — back to work.');
  });

  it('names the run that woke up', () => {
    expect(submitted).toContain(
      'Run wf_81c2 woke up the moment you submitted.',
    );
  });

  it('closes without promising an email nobody said would be sent', () => {
    // The mockup's second sentence is "you'll get
    // the draft by email", which assumes a
    // downstream this workflow may not have.
    expect(submitted).toContain('You can close this tab.');
    expect(submitted).not.toContain('by email');
  });

  it('shows what it woke up, in the order it runs', () => {
    expect(submitted.indexOf('Draft the sermon')).toBeGreaterThan(0);
    expect(submitted.indexOf('Email the draft')).toBeGreaterThan(
      submitted.indexOf('Draft the sermon'),
    );
  });

  it('marks the first step as the one running now', () => {
    expect(submitted).toContain('Draft the sermon ●');
  });

  it('renders the page', async () => {
    await expect(submitted).toMatchFileSnapshot(
      './__snapshots__/submitted-chips.html',
    );
  });
});

describe('the same page for a workflow with nothing downstream', () => {
  const bare = renderSubmittedPage({
    appTitle: 'Sermon Helper',
    runId: 'wf_81c2',
    downstream: [],
  });

  it('omits the strip rather than inventing steps for it', () => {
    // The chips come from the titles of the nodes
    // that run after this wait. With none, there
    // is nothing truthful to show.
    expect(bare).not.toContain('<span class="chip');
    expect(bare).toContain('Got it — back to work.');
  });

  it('renders the page', async () => {
    await expect(bare).toMatchFileSnapshot(
      './__snapshots__/submitted-bare.html',
    );
  });
});

describe('the page an already-answered link lands on', () => {
  const resolved = renderResolvedPage({
    appTitle: 'Sermon Helper',
    runId: 'wf_81c2',
  });

  it('says so without a form to fill in twice', () => {
    expect(resolved).toContain("That one's already answered.");
    expect(resolved).toContain('wf_81c2');
    expect(resolved).not.toContain('<form');
  });

  it('renders the page', async () => {
    await expect(resolved).toMatchFileSnapshot('./__snapshots__/resolved.html');
  });
});

describe('the page a link that does not verify lands on', () => {
  it('names the one thing that was wrong with it', () => {
    expect(renderInvalidPage('expired')).toContain('expired');
    expect(renderInvalidPage('signature')).toContain('signature');
  });

  it('offers nothing to press, because nothing here would help', () => {
    expect(renderInvalidPage('expired')).not.toContain('<form');
  });

  it('renders the page', async () => {
    await expect(renderInvalidPage('expired')).toMatchFileSnapshot(
      './__snapshots__/invalid.html',
    );
  });
});
