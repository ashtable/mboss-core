// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import express, { type Request, type Response, type Router } from 'express';

import type { ArtifactStore } from '../artifacts.js';
import type { EmailFormField, WaitDescriptor } from '../contract.js';
import type { WorkflowEntry } from '../contract.js';
import { boundaryOf, parseMultipart } from '../multipart.js';
import {
  renderApprovalDonePage,
  renderApprovalPage,
} from '../pages/approval.js';
import {
  renderFormPage,
  renderInvalidPage,
  renderResolvedPage,
  renderSubmittedPage,
} from '../pages/form.js';
import { verifyLink, type LinkKeyRing } from '../signed-links.js';

import { pathParam, type SendToRun } from './ports.js';

/**
 * `GET` and `POST /f/:token` — the form host.
 *
 * Two separate things are checked on every request
 * and both are necessary. The token proves the
 * holder was sent this link. The correlation table
 * says whether the run behind it is still waiting.
 * Nothing revokes a link, so without the second
 * check a form could be submitted a second time,
 * days later, against a run that had long since
 * moved on.
 *
 * One route serves both the form and the
 * approve-or-reject page, because an approval
 * mints an ordinary form token on purpose. Which
 * page to serve is settled by the workflow's own
 * list of waits, never by the token.
 *
 * A wait's node id is looked up across every
 * workflow this app carries. Node ids are unique
 * within a workflow; two workflows that used the
 * same one for a wait would render the first's
 * form. What is submitted is unaffected either
 * way — it is addressed by run and node.
 */

/** As much of a form post as this will read. */
const BODY_LIMIT = '25mb';

export type FormDeps = {
  appTitle: string;
  ring: LinkKeyRing;
  workflows: readonly WorkflowEntry[];
  send: SendToRun;
  isWaiting: (runId: string, nodeId: string) => Promise<boolean>;
  store: ArtifactStore | null;
};

/** What a verified, still-waiting request is. */
type Opened = {
  runId: string;
  nodeId: string;
  recipient: string;
  wait: WaitDescriptor;
};

export function formRoutes(deps: FormDeps): Router {
  const router = express.Router();

  router.get('/f/:token', (request, response) => {
    void open(deps, request, response)
      .then((opened) => {
        if (opened) response.type('html').send(pageFor(deps, opened, request));
      })
      .catch(failed(response));
  });

  // The body arrives raw and is parsed below.
  // Which parser to use depends on the form: one
  // that takes a file posts multipart and one that
  // does not posts an encoded string, and reading
  // it once here keeps the size limit in one
  // place.
  router.post(
    '/f/:token',
    express.raw({ type: () => true, limit: BODY_LIMIT }),
    (request, response) => {
      void open(deps, request, response)
        .then(async (opened) => {
          if (opened) await submit(deps, opened, request, response);
        })
        .catch(failed(response));
    },
  );

  return router;
}

function failed(response: Response): (error: unknown) => void {
  return (error: unknown) => {
    response.status(500).json({ error: String(error) });
  };
}

/**
 * The verified, still-waiting request behind a
 * token, or null — in which case the reply has
 * already been written.
 */
async function open(
  deps: FormDeps,
  request: Request,
  response: Response,
): Promise<Opened | null> {
  const token = pathParam(request, 'token');
  const result = verifyLink(deps.ring, token, 'app.form');

  if (!result.ok) {
    response.status(400).type('html').send(renderInvalidPage(result.reason));
    return null;
  }

  const { payload } = result;
  if (payload.t !== 'app.form') {
    response.status(400).type('html').send(renderInvalidPage('wrong-type'));
    return null;
  }

  const wait = waitFor(deps.workflows, payload.node);
  if (!wait) {
    // The token verifies but names a wait this
    // app no longer has, which happens when a
    // workflow is redrawn under a link already
    // sent.
    response.status(400).type('html').send(renderInvalidPage('unknown step'));
    return null;
  }

  if (!(await deps.isWaiting(payload.run, payload.node))) {
    response
      .status(410)
      .type('html')
      .send(
        renderResolvedPage({ appTitle: deps.appTitle, runId: payload.run }),
      );
    return null;
  }

  return {
    runId: payload.run,
    nodeId: payload.node,
    recipient: payload.sub,
    wait,
  };
}

function waitFor(
  workflows: readonly WorkflowEntry[],
  nodeId: string,
): WaitDescriptor | null {
  for (const entry of workflows) {
    const wait = entry.waits[nodeId];
    if (wait) return wait;
  }

  return null;
}

function pageFor(deps: FormDeps, opened: Opened, request: Request): string {
  const common = {
    appTitle: deps.appTitle,
    runId: opened.runId,
    recipient: opened.recipient,
    action: request.originalUrl,
    wait: opened.wait,
  };

  return opened.wait.page === 'approval'
    ? renderApprovalPage(common)
    : renderFormPage({ ...common, uploadsEnabled: deps.store !== null });
}

async function submit(
  deps: FormDeps,
  opened: Opened,
  request: Request,
  response: Response,
): Promise<void> {
  const posted = readBody(request);

  if (opened.wait.page === 'approval') {
    await submitDecision(deps, opened, posted, response);
    return;
  }

  const answers: Record<string, unknown> = {};

  for (const field of opened.wait.fields) {
    if (field.type === 'fileUpload') {
      const files = posted.files.filter(
        (file) => file.name === field.id && file.filename !== '',
      );

      if (files.length > 0 && deps.store === null) {
        // The page renders its dropzone disabled
        // when there is no store, so this is a
        // page that went stale. Say the same thing
        // the form itself says rather than losing
        // the file quietly.
        response
          .status(503)
          .type('html')
          .send(
            renderFormPage({
              appTitle: deps.appTitle,
              runId: opened.runId,
              recipient: opened.recipient,
              action: request.originalUrl,
              wait: opened.wait,
              uploadsEnabled: false,
            }),
          );
        return;
      }

      answers[field.id] = await storeFiles(deps, opened, field, files);
      continue;
    }

    const value = posted.fields[field.id];
    if (value === undefined) continue;
    answers[field.id] = field.type === 'yesNo' ? value === 'yes' : value;
  }

  await wake(deps, opened, answers);
  response.type('html').send(
    renderSubmittedPage({
      appTitle: deps.appTitle,
      runId: opened.runId,
      downstream: opened.wait.downstream,
    }),
  );
}

async function submitDecision(
  deps: FormDeps,
  opened: Opened,
  posted: PostedBody,
  response: Response,
): Promise<void> {
  const decision = posted.fields['decision'];

  if (decision !== 'approve' && decision !== 'reject') {
    response.status(400).type('html').send(renderInvalidPage('no decision'));
    return;
  }

  const approved = decision === 'approve';
  await wake(deps, opened, { approved });

  response.type('html').send(
    renderApprovalDonePage({
      appTitle: deps.appTitle,
      runId: opened.runId,
      approved,
      downstream: opened.wait.downstream,
    }),
  );
}

/**
 * The key is what the run is woken by, and it is
 * derived from the run and the node rather than
 * from the request, so a double-submitted form
 * lands once.
 */
async function wake(
  deps: FormDeps,
  opened: Opened,
  message: unknown,
): Promise<void> {
  await deps.send(
    opened.runId,
    message,
    opened.nodeId,
    `${opened.runId}:${opened.nodeId}`,
  );
}

type PostedFile = {
  name: string;
  filename: string;
  contentType: string;
  body: Uint8Array;
};

type PostedBody = {
  fields: Record<string, string>;
  files: PostedFile[];
};

function readBody(request: Request): PostedBody {
  const raw: unknown = request.body;
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.alloc(0);
  const boundary = boundaryOf(request.header('content-type'));

  if (boundary === null) {
    const parsed = new URLSearchParams(bytes.toString('utf8'));

    return { fields: Object.fromEntries(parsed), files: [] };
  }

  const fields: Record<string, string> = {};
  const files: PostedFile[] = [];

  for (const part of parseMultipart(bytes, boundary)) {
    if (part.kind === 'field') {
      fields[part.name] = part.value;
      continue;
    }
    files.push(part);
  }

  return { fields, files };
}

/**
 * Puts each file in the store and answers with the
 * descriptors.
 *
 * Descriptors, never bytes: what is sent from here
 * goes into a workflow's message, which is written
 * to the system database, and a buffer is exactly
 * the shape a workflow may not carry between
 * blocks.
 */
async function storeFiles(
  deps: FormDeps,
  opened: Opened,
  field: EmailFormField,
  files: PostedFile[],
): Promise<unknown> {
  const store = deps.store;
  const descriptors = [];

  for (const [index, file] of files.entries()) {
    const key =
      `runs/${opened.runId}/${opened.nodeId}/${field.id}/` +
      `${index}-${safeName(file.filename)}`;

    if (store) {
      await store.put({
        key,
        body: file.body,
        contentType: file.contentType,
      });
    }

    descriptors.push({
      id: key,
      filename: file.filename,
      contentType: file.contentType,
      size: file.body.byteLength,
    });
  }

  // A field that takes one file answers with one
  // descriptor, so a handler that declared one
  // thing is not handed a list of it.
  return field.multiple ? descriptors : (descriptors[0] ?? null);
}

/**
 * A filename made safe to build a storage key out
 * of. Whoever chose it is whoever the link was
 * sent to, so it is a person-supplied string in
 * the middle of an object name.
 *
 * Runs of dots go first and separators after, in
 * that order: replacing the separators alone would
 * leave `.._.._etc`, which addresses nothing today
 * and depends on that staying true of every store
 * this is ever pointed at.
 */
function safeName(filename: string): string {
  const safe = filename
    .replace(/\.{2,}/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 100);

  return safe === '' ? 'file' : safe;
}
