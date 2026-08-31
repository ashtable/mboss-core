import { describe, expect, it } from 'vitest';

import type { EmailFormField, NodeEmail } from '../contract.js';

import { describeField, renderNodeEmail } from './templates.js';

/**
 * The emails a workflow sends.
 *
 * One template with four attachment shapes, so
 * there are four snapshots. Each is a real HTML
 * file that can be opened and looked at, which is
 * the only way to review an email; the assertions
 * above each snapshot are the specification, and
 * the snapshot locks everything nobody wrote an
 * assertion for.
 *
 * The fixed sentences below are mBoss's chrome and
 * are meant to be identical in every app made with
 * it. The subject and the body are the workflow
 * author's.
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
];

function emailWith(attach: NodeEmail['attach']): NodeEmail {
  return {
    runId: 'wf_81c2',
    workflowTitle: 'Groom booking',
    nodeId: 'send_form',
    to: 'sam@hillsong.io',
    subject: 'Sermon Helper is ready for your notes',
    bodyMarkdown: '# Send us your notes.\n\nWhenever suits you.',
    attach,
    downstream: ['Draft the sermon'],
  };
}

const FORM_LINK = 'https://app.example.com/f/tok-form';

const form = renderNodeEmail({
  email: emailWith({
    kind: 'form',
    nodeId: 'await_form',
    fields: FIELDS,
    expiresInSeconds: 604800,
  }),
  appTitle: 'Sermon Helper',
  linkUrl: FORM_LINK,
});

describe('the email that carries a form link', () => {
  it('goes to the recipient under the subject the workflow chose', () => {
    expect(form.to).toBe('sam@hillsong.io');
    expect(form.subject).toBe('Sermon Helper is ready for your notes');
  });

  it('renders the body the workflow wrote', () => {
    expect(form.html).toContain('Send us your notes.');
    expect(form.html).toContain('Whenever suits you.');
  });

  it('carries the fixed sentence that introduces the form', () => {
    expect(form.html).toContain(
      'Your workflow started and is waiting on you. Open your secure form ' +
        'to:',
    );
  });

  it('describes each field rather than echoing its label', () => {
    expect(form.html).toContain('upload one or more documents');
    expect(form.html).toContain('tell it your request');
  });

  it('points its one button at the link it was given', () => {
    expect(form.html).toContain(`href="${FORM_LINK}"`);
    expect(form.html).toContain('Open your secure form');
  });

  it('closes with the strip that explains the link', () => {
    expect(form.html).toContain(
      'personal signed link — the link itself is the credential, no ' +
        'account needed · the run sleeps in Postgres until you submit — ' +
        'no rush',
    );
  });

  it('names the app and the run in the card', () => {
    expect(form.html).toContain('Sermon Helper');
    expect(form.html).toContain('run wf_81c2');
  });

  it('renders the card', async () => {
    await expect(form.html).toMatchFileSnapshot(
      './__snapshots__/node-email-form.html',
    );
  });
});

const approval = renderNodeEmail({
  email: {
    ...emailWith({
      kind: 'approval',
      nodeId: 'manager_ok',
      expiresInSeconds: 604800,
    }),
    subject: 'Approval needed: Manager sign-off',
    bodyMarkdown: 'Groom booking is waiting on your decision.',
  },
  appTitle: 'Sermon Helper',
  linkUrl: 'https://app.example.com/f/tok-approval',
});

describe('the email that asks for a decision', () => {
  it('carries the ask and nothing about filling a form in', () => {
    expect(approval.html).toContain(
      'Groom booking is waiting on your decision.',
    );
    expect(approval.html).not.toContain('Open your secure form to:');
  });

  it('labels its button for a decision', () => {
    // No mockup pins this label. It is authored
    // here, for the same reason the approve and
    // reject page is: nothing in the design covers
    // the approval email, and "open your secure
    // form" describes the wrong action.
    expect(approval.html).toContain('Review and decide');
  });

  it('renders the card', async () => {
    await expect(approval.html).toMatchFileSnapshot(
      './__snapshots__/node-email-approval.html',
    );
  });
});

const artifact = renderNodeEmail({
  email: {
    ...emailWith({
      kind: 'artifact',
      key: 'runs/wf_81c2/draft.md',
      expiresInSeconds: 604800,
    }),
    subject: 'Your draft is ready',
    bodyMarkdown: 'Your draft is ready.\n\nIt came out at about 20 minutes.',
  },
  appTitle: 'Sermon Helper',
  linkUrl: 'https://app.example.com/a/tok-artifact',
});

describe('the email that carries an artifact link', () => {
  it('labels its button for reading rather than answering', () => {
    expect(artifact.html).toContain('Read the full draft');
    expect(artifact.html).toContain('href="https://app.example.com/a/');
  });

  it('says how long the link lasts instead of promising a wait', () => {
    expect(artifact.html).toContain('this link expires in 7 days');
    expect(artifact.html).not.toContain('sleeps in Postgres');
  });

  it('renders the card', async () => {
    await expect(artifact.html).toMatchFileSnapshot(
      './__snapshots__/node-email-artifact.html',
    );
  });
});

const plain = renderNodeEmail({
  email: {
    ...emailWith({ kind: 'none' }),
    subject: 'Your booking is confirmed',
    bodyMarkdown: 'Your booking is confirmed for Tuesday at ten.',
  },
  appTitle: 'Sermon Helper',
  linkUrl: null,
});

describe('the email that carries no link', () => {
  it('offers no button, because there is nowhere to send anyone', () => {
    expect(plain.html).not.toContain('<a href=');
  });

  it('says so in the strip rather than promising a link', () => {
    expect(plain.html).toContain('there is nothing to open in this one');
    expect(plain.html).not.toContain('personal signed link');
  });

  it('renders the card', async () => {
    await expect(plain.html).toMatchFileSnapshot(
      './__snapshots__/node-email-plain.html',
    );
  });
});

/**
 * One bullet per field, written as an instruction
 * rather than as the field's label.
 *
 * Echoing the label would produce "· Documents",
 * which tells a recipient nothing about what they
 * are being asked to do with it.
 */
describe('describeField', () => {
  const field = (over: Partial<EmailFormField>): EmailFormField => ({
    id: 'f',
    label: 'Your request',
    type: 'text',
    required: true,
    multiple: false,
    ...over,
  });

  it('asks for several documents when the field takes several', () => {
    expect(describeField(field({ type: 'fileUpload', multiple: true }))).toBe(
      'upload one or more documents',
    );
  });

  it('asks for one when it takes one', () => {
    expect(describeField(field({ type: 'fileUpload' }))).toBe(
      'upload a document',
    );
  });

  it('asks a textarea to be told something', () => {
    expect(describeField(field({ type: 'textarea' }))).toBe(
      'tell it your request',
    );
  });

  it('asks a text field to be given something', () => {
    expect(describeField(field({ type: 'text' }))).toBe('give it your request');
  });

  it('asks a yes-or-no question in the words it was written in', () => {
    // Lowercasing "Is this urgent?" would read as
    // a mistake rather than as a sentence.
    expect(
      describeField(field({ type: 'yesNo', label: 'Is this urgent?' })),
    ).toBe('answer: Is this urgent?');
  });

  it('marks an optional field optional', () => {
    expect(describeField(field({ required: false }))).toBe(
      'give it your request (optional)',
    );
  });
});
