import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { withServer } from '../../../test-support/serve.js';
import type { ArtifactStore } from '../artifacts.js';
import type {
  PayloadCheck,
  WaitDescriptor,
  WorkflowEntry,
} from '../contract.js';
import { mintArtifactLink, mintFormLink } from '../links.js';
import { parseKeyRing } from '../signed-links.js';

import { formRoutes, type FormDeps } from './form.js';

/**
 * `GET` and `POST /f/:token` — the form host.
 *
 * Two things are being checked at once on every
 * request here, and they are genuinely separate.
 * The token says the holder was sent this link;
 * the correlation table says the run behind it is
 * still waiting. A link stays valid for its whole
 * life and nothing revokes it, so without the
 * second check a form could be submitted twice,
 * days apart, and the second submit would go to a
 * run that had long since moved on.
 */

const RING = parseKeyRing(`k1:${'ab'.repeat(32)}`);
const NOW = 1_767_225_600_000;

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

function formToken(runId: string, nodeId: string, life = 604800): string {
  return tokenOf(
    mintFormLink({
      ring: RING,
      baseUrl: 'https://app.example.com',
      runId,
      nodeId,
      to: 'sam@hillsong.io',
      expiresInSeconds: life,
      now: NOW,
    }),
  );
}

const FORM_WAIT: WaitDescriptor = {
  nodeId: 'await_form',
  title: 'Collect the sermon notes',
  page: 'form',
  fields: [
    {
      id: 'docs',
      label: 'Documents',
      type: 'fileUpload',
      required: false,
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
      id: 'urgent',
      label: 'Is this urgent?',
      type: 'yesNo',
      required: true,
      multiple: false,
    },
  ],
  downstream: ['Draft the sermon'],
};

const APPROVAL_WAIT: WaitDescriptor = {
  nodeId: 'manager_ok',
  title: 'Manager sign-off',
  page: 'approval',
  fields: [],
  downstream: ['Pay the invoice'],
};

async function nothing(): Promise<void> {}

function workflow(waits: WaitDescriptor[]): WorkflowEntry {
  return {
    name: 'groom_booking',
    title: 'Groom booking',
    workflowFn: nothing,
    trigger: { mode: 'manual' },
    checkPayload: (): PayloadCheck => ({
      ok: true,
      key: undefined,
      requesterEmail: undefined,
    }),
    waits: Object.fromEntries(waits.map((wait) => [wait.nodeId, wait])),
    eventWaits: [],
  };
}

type Sent = { runId: string; message: unknown; nodeId: string; key: string };

const STORE: ArtifactStore = {
  async put() {},
  async presign(key) {
    return `https://s3.example.com/${key}`;
  },
};

function harness(options: {
  waiting?: Set<string>;
  workflows?: WorkflowEntry[];
  store?: ArtifactStore | null;
}) {
  const sent: Sent[] = [];
  const stored: { key: string; contentType: string; bytes: number }[] = [];
  const waiting = options.waiting ?? new Set(['wf_1 await_form']);
  const store = options.store === undefined ? STORE : options.store;

  const deps: FormDeps = {
    appTitle: 'Sermon Helper',
    ring: RING,
    workflows: options.workflows ?? [workflow([FORM_WAIT, APPROVAL_WAIT])],
    async send(runId, message, nodeId, key) {
      sent.push({ runId, message, nodeId, key });
    },
    async isWaiting(runId, nodeId) {
      return waiting.has(`${runId} ${nodeId}`);
    },
    store:
      store === null
        ? null
        : {
            async put(input) {
              stored.push({
                key: input.key,
                contentType: input.contentType,
                bytes: input.body.byteLength,
              });

              return store.put(input);
            },
            presign: store.presign,
          },
  };

  const app = express();
  app.use(formRoutes(deps));

  return { app, sent, stored, waiting };
}

async function get(
  app: express.Express,
  path: string,
): Promise<{ status: number; body: string }> {
  return withServer(app, async (base) => {
    const response = await fetch(`${base}${path}`);

    return { status: response.status, body: await response.text() };
  });
}

async function postForm(
  app: express.Express,
  path: string,
  fields: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return withServer(app, async (base) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });

    return { status: response.status, body: await response.text() };
  });
}

const BOUNDARY = '----mbossFormBoundary';

async function postMultipart(
  app: express.Express,
  path: string,
  parts: string[],
): Promise<{ status: number; body: string }> {
  const body = parts
    .map((part) => `--${BOUNDARY}\r\n${part}\r\n`)
    .concat(`--${BOUNDARY}--\r\n`)
    .join('');

  return withServer(app, async (base) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      body: Buffer.from(body, 'binary'),
    });

    return { status: response.status, body: await response.text() };
  });
}

describe('a link that does not verify', () => {
  const cases = [
    { name: 'is not a token at all', token: 'rubbish', reason: 'malformed' },
    {
      name: 'was signed by something else',
      token: `${formToken('wf_1', 'await_form').split('.')[0]}.AAAA`,
      reason: 'malformed',
    },
  ];

  it.each(cases)('$name', async ({ token, reason }) => {
    const { app } = harness({});
    const response = await get(app, `/f/${token}`);

    expect(response.status).toBe(400);
    expect(response.body).toContain(reason);
  });

  it('is refused when its signature is wrong', async () => {
    const [claims] = formToken('wf_1', 'await_form').split('.');
    const forged = `${claims}.${Buffer.alloc(32, 7).toString('base64url')}`;
    const { app } = harness({});
    const response = await get(app, `/f/${forged}`);

    expect(response.status).toBe(400);
    expect(response.body).toContain('signature');
  });

  it('is refused when it has expired', async () => {
    const { app } = harness({});
    const stale = formToken('wf_1', 'await_form', 60);
    vi.setSystemTime(NOW + 120_000);

    try {
      const response = await get(app, `/f/${stale}`);

      expect(response.status).toBe(400);
      expect(response.body).toContain('expired');
    } finally {
      vi.setSystemTime(NOW);
    }
  });

  it('is refused when it is an artifact token', async () => {
    const artifact = tokenOf(
      mintArtifactLink({
        ring: RING,
        baseUrl: 'https://app.example.com',
        key: 'k',
        to: 'sam@hillsong.io',
        expiresInSeconds: 604800,
        now: NOW,
      }),
    );
    const { app } = harness({});
    const response = await get(app, `/f/${artifact}`);

    expect(response.status).toBe(400);
    expect(response.body).toContain('wrong-type');
  });

  it('reports the expiry first when it is both stale and wrong', async () => {
    // The order of the checks is fixed: parse,
    // signature, expiry, then type. An expired
    // token of the wrong type reports expired, and
    // a reader of this page should not have to
    // guess which of the two it was told about.
    const artifact = tokenOf(
      mintArtifactLink({
        ring: RING,
        baseUrl: 'https://app.example.com',
        key: 'k',
        to: 'sam@hillsong.io',
        expiresInSeconds: 60,
        now: NOW,
      }),
    );
    const { app } = harness({});
    vi.setSystemTime(NOW + 120_000);

    try {
      const response = await get(app, `/f/${artifact}`);

      expect(response.body).toContain('expired');
      expect(response.body).not.toContain('wrong-type');
    } finally {
      vi.setSystemTime(NOW);
    }
  });
});

describe('a valid link to a form', () => {
  it('renders the form the wait describes', async () => {
    const { app } = harness({});
    const response = await get(app, `/f/${formToken('wf_1', 'await_form')}`);

    expect(response.status).toBe(200);
    expect(response.body).toContain('Sermon Helper needs your input');
    expect(response.body).toContain('name="request"');
    expect(response.body).toContain('Collect the sermon notes');
  });

  it('names the person the link was minted for in its banner', async () => {
    const { app } = harness({});
    const response = await get(app, `/f/${formToken('wf_1', 'await_form')}`);

    expect(response.body).toContain('personal signed link for sam@hillsong.io');
    expect(response.body).toContain('run wf_1 sleeps until you submit');
  });

  it('offers the dropzone only when there is somewhere to put a file', async () => {
    const { app } = harness({ store: null });
    const response = await get(app, `/f/${formToken('wf_1', 'await_form')}`);

    expect(response.body).toContain('File uploads are switched off');
  });
});

describe('a valid link to an approval', () => {
  it('renders the two buttons rather than a form', async () => {
    // The token cannot say which page to serve —
    // an approval mints an ordinary form token, on
    // purpose — so the workflow's own list of
    // waits is what settles it.
    const { app } = harness({ waiting: new Set(['wf_1 manager_ok']) });
    const response = await get(app, `/f/${formToken('wf_1', 'manager_ok')}`);

    expect(response.status).toBe(200);
    expect(response.body).toContain('Sermon Helper needs your decision');
    expect(response.body).toContain('value="approve"');
  });
});

describe('a link whose node no workflow declares', () => {
  it('is refused, because there is no page to build', async () => {
    const { app } = harness({});
    const response = await get(app, `/f/${formToken('wf_1', 'no_such_node')}`);

    expect(response.status).toBe(400);
  });
});

describe('a run that has already answered', () => {
  it('is told so, and offered no form to fill in twice', async () => {
    const { app } = harness({ waiting: new Set() });
    const response = await get(app, `/f/${formToken('wf_1', 'await_form')}`);

    expect(response.status).toBe(410);
    expect(response.body).toContain("That one's already answered.");
    expect(response.body).not.toContain('<form');
  });

  it('is told so even while another run waits on the same node', async () => {
    // Every run parked on a form node registers the
    // same key, so a check that asked "is anybody
    // waiting on this node" would answer yes here
    // and serve a form whose submit went nowhere.
    const { app } = harness({ waiting: new Set(['wf_2 await_form']) });
    const response = await get(app, `/f/${formToken('wf_1', 'await_form')}`);

    expect(response.status).toBe(410);
  });

  it('refuses the submit as well, not only the page', async () => {
    const { app, sent } = harness({ waiting: new Set() });
    const response = await postForm(
      app,
      `/f/${formToken('wf_1', 'await_form')}`,
      { request: 'hello', urgent: 'yes' },
    );

    expect(response.status).toBe(410);
    expect(sent).toEqual([]);
  });
});

describe('submitting a form', () => {
  it('wakes the run with the answers, keyed so a double submit lands once', async () => {
    const { app, sent } = harness({});
    const response = await postForm(
      app,
      `/f/${formToken('wf_1', 'await_form')}`,
      { request: 'a sermon please', urgent: 'yes' },
    );

    expect(response.status).toBe(200);
    expect(sent).toEqual([
      {
        runId: 'wf_1',
        nodeId: 'await_form',
        key: 'wf_1:await_form',
        // The declared file field answers with an
        // empty list rather than being left out.
        // The handler downstream declared a type
        // that has it, and an absent property is
        // not the same as none chosen.
        message: { docs: [], request: 'a sermon please', urgent: true },
      },
    ]);
  });

  it('turns a no into a boolean, the same as a yes', async () => {
    const { app, sent } = harness({});

    await postForm(app, `/f/${formToken('wf_1', 'await_form')}`, {
      request: 'x',
      urgent: 'no',
    });

    expect(sent[0]?.message).toMatchObject({ urgent: false });
  });

  it('sends only the fields the wait declared', async () => {
    // Anything else in the body is somebody
    // posting by hand, and the handler downstream
    // declared a type that does not have it.
    const { app, sent } = harness({});

    await postForm(app, `/f/${formToken('wf_1', 'await_form')}`, {
      request: 'x',
      urgent: 'yes',
      sneaky: 'value',
    });

    expect(sent[0]?.message).not.toHaveProperty('sneaky');
  });

  it('lands on the page that says what it woke up', async () => {
    const { app } = harness({});
    const response = await postForm(
      app,
      `/f/${formToken('wf_1', 'await_form')}`,
      { request: 'x', urgent: 'yes' },
    );

    expect(response.body).toContain('Got it — back to work.');
    expect(response.body).toContain('Draft the sermon ●');
  });
});

describe('submitting a decision', () => {
  it('sends an approval as a boolean', async () => {
    const { app, sent } = harness({ waiting: new Set(['wf_1 manager_ok']) });
    const response = await postForm(
      app,
      `/f/${formToken('wf_1', 'manager_ok')}`,
      { decision: 'approve' },
    );

    expect(response.status).toBe(200);
    expect(sent[0]?.message).toEqual({ approved: true });
    expect(response.body).toContain('your answer: approved');
  });

  it('sends a rejection the same way', async () => {
    const { app, sent } = harness({ waiting: new Set(['wf_1 manager_ok']) });
    const response = await postForm(
      app,
      `/f/${formToken('wf_1', 'manager_ok')}`,
      { decision: 'reject' },
    );

    expect(sent[0]?.message).toEqual({ approved: false });
    expect(response.body).toContain('your answer: rejected');
  });

  it('refuses a decision that is neither, rather than guessing', async () => {
    const { app, sent } = harness({ waiting: new Set(['wf_1 manager_ok']) });
    const response = await postForm(
      app,
      `/f/${formToken('wf_1', 'manager_ok')}`,
      { decision: 'maybe' },
    );

    expect(response.status).toBe(400);
    expect(sent).toEqual([]);
  });
});

describe('submitting a file', () => {
  const filePart =
    'content-disposition: form-data; name="docs"; ' +
    'filename="notes.txt"\r\ncontent-type: text/plain\r\n\r\nhello';
  const textParts = [
    'content-disposition: form-data; name="request"\r\n\r\nx',
    'content-disposition: form-data; name="urgent"\r\n\r\nyes',
  ];

  it('stores the bytes and sends a descriptor, never the bytes', async () => {
    // Bytes through a DBOS message would be written
    // into the system database, and a buffer is
    // exactly the shape a workflow is not allowed
    // to carry between blocks.
    const { app, sent, stored } = harness({});
    const response = await postMultipart(
      app,
      `/f/${formToken('wf_1', 'await_form')}`,
      [filePart, ...textParts],
    );

    expect(response.status).toBe(200);
    expect(stored).toEqual([
      {
        key: 'runs/wf_1/await_form/docs/0-notes.txt',
        contentType: 'text/plain',
        bytes: 5,
      },
    ]);
    expect(sent[0]?.message).toEqual({
      docs: [
        {
          id: 'runs/wf_1/await_form/docs/0-notes.txt',
          filename: 'notes.txt',
          contentType: 'text/plain',
          size: 5,
        },
      ],
      request: 'x',
      urgent: true,
    });
  });

  it('drops a file input nobody chose a file for', async () => {
    const { app, sent, stored } = harness({});
    const empty =
      'content-disposition: form-data; name="docs"; filename=""\r\n' +
      'content-type: application/octet-stream\r\n\r\n';

    await postMultipart(app, `/f/${formToken('wf_1', 'await_form')}`, [
      empty,
      ...textParts,
    ]);

    expect(stored).toEqual([]);
    expect(sent[0]?.message).toMatchObject({ docs: [] });
  });

  it('keeps a filename out of the storage key it cannot be trusted in', async () => {
    const { app, stored } = harness({});
    const nasty =
      'content-disposition: form-data; name="docs"; ' +
      'filename="../../etc/passwd"\r\n\r\nx';

    await postMultipart(app, `/f/${formToken('wf_1', 'await_form')}`, [
      nasty,
      ...textParts,
    ]);

    expect(stored[0]?.key).not.toContain('..');
    expect(stored[0]?.key).toBe('runs/wf_1/await_form/docs/0-____etc_passwd');
  });

  it('will not take a file when there is nowhere to put it', async () => {
    const { app, sent } = harness({ store: null });
    const response = await postMultipart(
      app,
      `/f/${formToken('wf_1', 'await_form')}`,
      [filePart, ...textParts],
    );

    expect(response.status).toBe(503);
    expect(response.body).toContain('File uploads are switched off');
    expect(sent).toEqual([]);
  });
});
