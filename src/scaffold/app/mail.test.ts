import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { NodeEmail } from './contract.js';
import type { EmailMessage } from './email/message.js';
import { sendNodeEmail, type MailDeps } from './mail.js';
import type { SendReceipt } from './mailer.js';
import { parseKeyRing, verifyLink } from './signed-links.js';

/**
 * The one call a workflow makes to send anything.
 *
 * It mints the link, renders the template and
 * sends, all inside the step the workflow wrapped
 * around it. Minting is why: `iat` and `exp` come
 * from the clock, so a workflow body that minted
 * its own link would produce a different token on
 * every replay. Keeping all three here means the
 * generated code has no minting call in it at all.
 */

const RING = parseKeyRing(`k1:${'ab'.repeat(32)}`);
const NOW = 1_767_225_600_000;

// The tokens below are checked with `verifyLink`,
// which reads the real clock for the expiry. Hold
// it at the instant they were minted at, or every
// one of them is already expired.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

function recording(): { sent: EmailMessage[]; deps: MailDeps } {
  const sent: EmailMessage[] = [];

  return {
    sent,
    deps: {
      ring: RING,
      baseUrl: 'https://app.example.com',
      appTitle: 'Sermon Helper',
      now: () => NOW,
      mailer: {
        async send(message): Promise<SendReceipt> {
          sent.push(message);

          return { operationId: 'OP1', operationLocation: 'https://x/OP1' };
        },
      },
    },
  };
}

function emailWith(attach: NodeEmail['attach']): NodeEmail {
  return {
    runId: 'wf_81c2',
    workflowTitle: 'Groom booking',
    nodeId: 'send_form',
    to: 'sam@hillsong.io',
    subject: 'Your form is ready',
    bodyMarkdown: 'Please have a look.',
    attach,
    downstream: [],
  };
}

/** The token out of the one URL in a message. */
function tokenIn(html: string, route: string): string {
  const at = html.indexOf(`https://app.example.com/${route}/`);
  const rest = html.slice(at).split('"')[0] ?? '';

  return rest.slice(rest.lastIndexOf('/') + 1);
}

describe('sending a node email', () => {
  it('sends to the recipient with the subject the node chose', async () => {
    const { sent, deps } = recording();
    await sendNodeEmail(emailWith({ kind: 'none' }), deps);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('sam@hillsong.io');
    expect(sent[0]?.subject).toBe('Your form is ready');
  });

  it('puts no link in a message that attaches nothing', async () => {
    const { sent, deps } = recording();
    await sendNodeEmail(emailWith({ kind: 'none' }), deps);

    expect(sent[0]?.html).not.toContain('https://app.example.com/');
  });
});

describe('a form attachment', () => {
  it('carries a token scoped to the wait, not to the email node', async () => {
    // The page a link opens is looked up in the
    // workflow's waits. A token scoped to the
    // node that sent the mail would resolve to no
    // wait at all and serve an error on a link
    // that is perfectly valid.
    const { sent, deps } = recording();
    await sendNodeEmail(
      emailWith({
        kind: 'form',
        nodeId: 'await_form',
        fields: [],
        expiresInSeconds: 604800,
      }),
      deps,
    );

    const result = verifyLink(
      RING,
      tokenIn(sent[0]?.html ?? '', 'f'),
      'app.form',
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.payload).toMatchObject({
      run: 'wf_81c2',
      node: 'await_form',
      sub: 'sam@hillsong.io',
    });
  });
});

describe('an approval attachment', () => {
  it('mints an ordinary form token for the approval node', async () => {
    // An approval reuses the whole form mechanism,
    // so there is no third token type: which page
    // the link opens is settled by the workflow's
    // waits, never by the token.
    const { sent, deps } = recording();
    await sendNodeEmail(
      emailWith({
        kind: 'approval',
        nodeId: 'manager_ok',
        expiresInSeconds: 604800,
      }),
      deps,
    );

    const result = verifyLink(
      RING,
      tokenIn(sent[0]?.html ?? '', 'f'),
      'app.form',
    );

    expect(result.ok && result.payload).toMatchObject({ node: 'manager_ok' });
  });
});

describe('an artifact attachment', () => {
  it('mints an artifact token over the storage key', async () => {
    const { sent, deps } = recording();
    await sendNodeEmail(
      emailWith({
        kind: 'artifact',
        key: 'runs/wf_81c2/draft.md',
        expiresInSeconds: 604800,
      }),
      deps,
    );

    const html = sent[0]?.html ?? '';
    const result = verifyLink(RING, tokenIn(html, 'a'), 'app.artifact');

    expect(html).toContain('https://app.example.com/a/');
    expect(result.ok && result.payload).toMatchObject({
      art: 'runs/wf_81c2/draft.md',
    });
  });
});

describe('the same email twice', () => {
  it('produces the same token, because the clock is a parameter', async () => {
    // A step is retried and a workflow is replayed.
    // A link that changed each time would leave
    // the recipient holding one that no longer
    // matches anything.
    const first = recording();
    const second = recording();
    const email = emailWith({
      kind: 'form',
      nodeId: 'await_form',
      fields: [],
      expiresInSeconds: 604800,
    });

    await sendNodeEmail(email, first.deps);
    await sendNodeEmail(email, second.deps);

    expect(first.sent[0]?.html).toBe(second.sent[0]?.html);
  });
});
