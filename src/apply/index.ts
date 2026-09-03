import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';

import {
  WorkflowIRSchema,
  WorkflowNameSchema,
  carryPositions,
  type WorkflowIR,
} from '../ir/index.js';
import type { LibManifest } from '../manifest/index.js';
import {
  hasErrors,
  validateWorkflow,
  type Diagnostic,
} from '../validate/index.js';

import { writeFileAtomic } from './atomic-write.js';
import { diffSummary, type DiffSummary } from './diff.js';
import { failed, type ApplyError, type Failure } from './errors.js';
import { hasCode } from './fs-error.js';
import { newestSnapshot, snapshot } from './history.js';
import { withLock } from './lock.js';
import { workflowFile, workflowsDir } from './paths.js';
import {
  WorkflowSpecSchema,
  mintProposalId,
  readProposal,
  supersede,
  writeProposal,
  type Proposal,
  type WorkflowSpec,
} from './proposal.js';

/**
 * The one way a workflow document changes.
 *
 * Two things have to be true at once and neither
 * gives you the other. An atomic write stops a
 * reader seeing half a document, and does nothing
 * about two writers overwriting each other; a
 * `baseRevision` check catches an edit made
 * against content that has moved on, and is itself
 * a race unless something serialises the read and
 * the write. So every write path here runs inside
 * one lock covering read → validate → snapshot →
 * write-temp → rename, and inside that lock the
 * revision check means what it says.
 *
 * Nothing here lays anything out, but a write
 * does carry the coordinates a person set: an
 * apply is about what a workflow *is*, and a spec
 * silent about where a block sits is not asking
 * for it to move.
 */

/**
 * The document format this module writes. Taken
 * from the schema rather than written out again,
 * so a format version can only ever change in one
 * place.
 */
const SCHEMA_URL = WorkflowIRSchema.shape.$schema.value;

/**
 * What `readWorkflow` gives back.
 */
export type ReadOutcome = { ok: true; ir: WorkflowIR } | Failure;

/**
 * What every write gives back: the document as it
 * now stands, what changed, and the warnings it
 * carries.
 *
 * `diagnostics` on a successful apply is never
 * empty of meaning — a document with warnings is a
 * legal draft, and the warnings are how the author
 * finds out what is still undone.
 */
export type ApplyOutcome =
  | {
      ok: true;
      ir: WorkflowIR;
      summary: DiffSummary;
      diagnostics: Diagnostic[];
    }
  | Failure;

/**
 * An edit: the workflow to change, what it should
 * become, and the revision the caller based that
 * on. `baseRevision` is null when the caller
 * believes the workflow does not exist yet.
 */
export type ApplyRequest = {
  name: string;
  spec: WorkflowSpec;
  baseRevision: number | null;
};

/**
 * The `/lib` manifest is optional everywhere it
 * appears here. Without it the two validation
 * rules that name it cannot tell a handler that is
 * wrong from a handler that is merely new, which
 * is the right answer in a tool that never scanned
 * the project.
 */
export type ApplyOptions = { manifest?: LibManifest };

/**
 * What `proposeSpec` gives back. The proposal
 * carries the diff and the diagnostics, so a
 * caller that renders a preview needs nothing
 * else.
 */
export type ProposeOutcome = { ok: true; proposal: Proposal } | Failure;

/**
 * An edit an agent wants a person to approve.
 * `proposedBy` is shown on the preview — "proposed
 * by claude code" — so a person knows whose edit
 * they are looking at.
 */
export type ProposeRequest = ApplyRequest & { proposedBy: string };

/**
 * Reads a workflow. No lock: a document is
 * replaced by a rename, so a reader sees the whole
 * of one version or the whole of another.
 */
export async function readWorkflow(
  mbossDir: string,
  name: string,
): Promise<ReadOutcome> {
  const missing = unusableRequest(mbossDir, name);
  if (missing !== undefined) return failed(missing);

  const ir = await readDocument(mbossDir, name);
  if (ir === undefined) return failed({ code: 'WORKFLOW_NOT_FOUND', name });

  return { ok: true, ir };
}

/**
 * Applies a spec, raising the workflow's revision
 * by one.
 */
export async function applySpec(
  mbossDir: string,
  request: ApplyRequest,
  opts?: ApplyOptions,
): Promise<ApplyOutcome> {
  const missing = unusableRequest(mbossDir, request.name);
  if (missing !== undefined) return failed(missing);

  return await withLock(mbossDir, async () => {
    const current = await readDocument(mbossDir, request.name);

    const stale = staleBase(current, request.baseRevision, request.name);
    if (stale !== undefined) return failed(stale);

    return await writeSpec(mbossDir, {
      name: request.name,
      spec: request.spec,
      current,
      prior: 'snapshot',
      manifest: opts?.manifest,
    });
  });
}

/**
 * Validates a spec and writes it down as a
 * proposal, leaving the workflow alone.
 *
 * The base revision is checked here and not only
 * at apply time so that an agent working from a
 * document that has already moved on finds out
 * before a person is asked to approve something
 * that cannot land.
 */
export async function proposeSpec(
  mbossDir: string,
  request: ProposeRequest,
  opts?: ApplyOptions,
): Promise<ProposeOutcome> {
  const missing = unusableRequest(mbossDir, request.name);
  if (missing !== undefined) return failed(missing);

  return await withLock(mbossDir, async () => {
    const current = await readDocument(mbossDir, request.name);

    const stale = staleBase(current, request.baseRevision, request.name);
    if (stale !== undefined) return failed(stale);

    const candidate = documentFrom(request.name, request.spec, current);
    const diagnostics = validateWorkflow(candidate, {
      manifest: opts?.manifest,
    });

    const invalid = validationFailure(diagnostics);
    if (invalid !== undefined) return failed(invalid);

    const proposal: Proposal = {
      id: mintProposalId(),
      workflow: candidate.name,
      baseRevision: request.baseRevision,
      spec: {
        title: candidate.title,
        nodes: candidate.nodes,
        edges: candidate.edges,
      },
      summary: diffSummary(current, candidate),
      diagnostics,
      proposedBy: request.proposedBy,
      createdAt: new Date().toISOString(),
      status: 'proposed',
    };

    await writeProposal(mbossDir, proposal);
    await supersede(mbossDir, proposal.workflow, proposal.id);

    return { ok: true, proposal };
  });
}

/**
 * Applies a proposal a person has approved.
 *
 * A proposal that is not outstanding — already
 * applied, declined, superseded by a newer one, or
 * never minted at all — is reported as not found
 * rather than as a different kind of refusal for
 * each: to a caller they are one situation, "this
 * is not something you can apply", and the retry
 * is the same in all four cases.
 */
export async function applyProposal(
  mbossDir: string,
  id: string,
  opts?: ApplyOptions,
): Promise<ApplyOutcome> {
  const missing = notAProject(mbossDir);
  if (missing !== undefined) return failed(missing);

  return await withLock(mbossDir, async () => {
    const proposal = await readProposal(mbossDir, id);
    if (proposal === undefined || proposal.status !== 'proposed') {
      return failed({ code: 'PROPOSAL_NOT_FOUND', id });
    }

    const current = await readDocument(mbossDir, proposal.workflow);

    const stale = staleProposal(proposal, current);
    if (stale !== undefined) return failed(stale);

    const outcome = await writeSpec(mbossDir, {
      name: proposal.workflow,
      spec: proposal.spec,
      current,
      prior: 'snapshot',
      manifest: opts?.manifest,
    });

    if (outcome.ok) {
      await writeProposal(mbossDir, { ...proposal, status: 'applied' });
    }

    return outcome;
  });
}

/**
 * Takes back the most recent apply.
 *
 * The restored document gets the *next* revision,
 * never its old one. The counter says how many
 * times this workflow has been written, not which
 * content it holds, and a counter that went
 * backwards would let an outstanding proposal's
 * base revision match content the proposal was
 * never made against — the proposal would then
 * apply as though the undo had not happened.
 */
export async function undo(
  mbossDir: string,
  name: string,
  opts?: ApplyOptions,
): Promise<ApplyOutcome> {
  const missing = unusableRequest(mbossDir, name);
  if (missing !== undefined) return failed(missing);

  return await withLock(mbossDir, async () => {
    const current = await readDocument(mbossDir, name);
    if (current === undefined) {
      return failed({ code: 'WORKFLOW_NOT_FOUND', name });
    }

    const previous = await newestSnapshot(mbossDir, name);
    if (previous === undefined)
      return failed({ code: 'NOTHING_TO_UNDO', name });

    const outcome = await writeSpec(mbossDir, {
      name,
      spec: {
        title: previous.ir.title,
        nodes: previous.ir.nodes,
        edges: previous.ir.edges,
      },
      current,
      prior: 'discard',
      manifest: opts?.manifest,
    });

    // Consumed only once the restore is on disk,
    // so a refused undo costs no history.
    if (outcome.ok) await rm(previous.path, { force: true });

    return outcome;
  });
}

/**
 * What becomes of the document being replaced.
 *
 * An ordinary apply files it in history. An undo
 * is already reading from history, and filing the
 * document it is undoing would turn the next undo
 * into a redo — the two of them toggling between
 * the same pair of versions instead of walking
 * back.
 */
type PriorDocument = 'snapshot' | 'discard';

/**
 * One edit, as `writeSpec` needs it.
 */
type Edit = {
  name: string;
  spec: WorkflowSpec;
  current: WorkflowIR | undefined;
  prior: PriorDocument;
  manifest?: LibManifest;
};

/**
 * Writes the next version of a document.
 *
 * Called only with the lock held: it reads nothing
 * itself, taking `current` from the caller
 * precisely so that the read it is based on
 * happened inside the same critical section as the
 * write.
 *
 * The one place positions are carried, because
 * it is the one place a spec becomes the
 * document: an agent's write, an approved
 * proposal and an undo's restore all pass through
 * here, and none of them is asked to know about
 * coordinates. `proposeSpec` deliberately does
 * not carry — a proposal is filed as the agent
 * wrote it, and the layout it lands in is the one
 * on disk when it lands.
 */
async function writeSpec(mbossDir: string, edit: Edit): Promise<ApplyOutcome> {
  const next = documentFrom(
    edit.name,
    carryPositions(edit.current, edit.spec),
    edit.current,
  );

  const diagnostics = validateWorkflow(next, { manifest: edit.manifest });

  const invalid = validationFailure(diagnostics);
  if (invalid !== undefined) return failed(invalid);

  if (edit.current !== undefined && edit.prior === 'snapshot') {
    await snapshot(mbossDir, edit.current);
  }

  await mkdir(workflowsDir(mbossDir), { recursive: true });
  await writeFileAtomic(workflowFile(mbossDir, edit.name), documentText(next));

  return {
    ok: true,
    ir: next,
    summary: diffSummary(edit.current, next),
    diagnostics,
  };
}

/**
 * Assembles the document a spec is asking for.
 *
 * The revision is set here and nowhere else, which
 * is what makes "exactly one higher than what is
 * on disk" a property of the module rather than a
 * habit of its call sites.
 *
 * The spec is stripped to its own fields first,
 * because it is not always a literal a caller
 * wrote: the natural way to say "this document
 * with one more block" is to spread the document
 * that was read, and a spec arriving with an
 * envelope on it would otherwise name its own
 * revision — freezing the counter, so that every
 * later base revision matches and the conflict
 * check stops catching anything — or its own
 * workflow, sending an approved edit to a file
 * nobody agreed to change.
 */
function documentFrom(
  name: string,
  spec: WorkflowSpec,
  current: WorkflowIR | undefined,
): WorkflowIR {
  const body = WorkflowSpecSchema.parse(spec);

  return WorkflowIRSchema.parse({
    $schema: SCHEMA_URL,
    version: 1,
    revision: (current?.revision ?? 0) + 1,
    name,
    ...body,
  });
}

/**
 * The gate an edit has to pass. Warnings are not
 * findings against the edit — they are the parts
 * of the workflow the author has not done yet, and
 * a canvas that refused to save until they were
 * gone could not be used to draw anything.
 */
function validationFailure(
  diagnostics: readonly Diagnostic[],
): ApplyError | undefined {
  if (!hasErrors(diagnostics)) return undefined;

  return {
    code: 'VALIDATION_FAILED',
    errors: diagnostics.filter((found) => found.severity === 'error'),
  };
}

/**
 * Whether the caller's idea of the current
 * revision still matches the file.
 *
 * A null base is a claim too — "there is no such
 * workflow" — and a wrong one is the same lost
 * update as any other, so it gets the same
 * conflict.
 */
function staleBase(
  current: WorkflowIR | undefined,
  baseRevision: number | null,
  name: string,
): ApplyError | undefined {
  if (current === undefined) {
    if (baseRevision === null) return undefined;

    return { code: 'WORKFLOW_NOT_FOUND', name };
  }

  if (baseRevision === current.revision) return undefined;

  return {
    code: 'REVISION_CONFLICT',
    expected: baseRevision,
    actual: current.revision,
  };
}

/**
 * Whether the document has moved on since the
 * proposal was written.
 *
 * A different code from `applySpec`'s conflict
 * because the answer is different: a caller
 * holding a stale base revision re-reads and
 * retries, where an approved-but-stale proposal
 * has to be re-proposed against the document as it
 * now is — nobody has approved this edit against
 * that content.
 */
function staleProposal(
  proposal: Proposal,
  current: WorkflowIR | undefined,
): ApplyError | undefined {
  if (current === undefined) {
    if (proposal.baseRevision === null) return undefined;

    return { code: 'WORKFLOW_NOT_FOUND', name: proposal.workflow };
  }

  if (proposal.baseRevision === current.revision) return undefined;

  return {
    code: 'PROPOSAL_STALE',
    baseRevision: proposal.baseRevision,
    currentRevision: current.revision,
  };
}

function notAProject(mbossDir: string): ApplyError | undefined {
  return existsSync(mbossDir)
    ? undefined
    : { code: 'NOT_AN_MBOSS_PROJECT', path: mbossDir };
}

/**
 * Whether the caller's name is one a workflow file
 * could carry.
 *
 * A name outside the slug format is a well-formed
 * request for something that is not there —
 * `Booking`, `booking-flow`, the two an agent
 * reaches for first — so it gets the answer every
 * other well-formed request gets, rather than a
 * parse error thrown out from under the tool call
 * that made it. This is the same treatment
 * `readProposal` gives an id it could not have
 * minted, for the same reason.
 */
function unusableName(name: string): ApplyError | undefined {
  return WorkflowNameSchema.safeParse(name).success
    ? undefined
    : { code: 'WORKFLOW_NOT_FOUND', name };
}

/**
 * The two things every entry point checks first:
 * there is a project here, and the name it was
 * given is one this module could write.
 */
function unusableRequest(
  mbossDir: string,
  name: string,
): ApplyError | undefined {
  return notAProject(mbossDir) ?? unusableName(name);
}

/**
 * Reads a document, or reports that there is none.
 *
 * A file that is there but is not a workflow
 * throws rather than reading as absent: this is
 * the source of truth, and quietly treating a
 * corrupted one as a blank slate is how an edit
 * becomes a deletion.
 */
async function readDocument(
  mbossDir: string,
  name: string,
): Promise<WorkflowIR | undefined> {
  let text: string;
  try {
    text = await readFile(workflowFile(mbossDir, name), 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }

  return WorkflowIRSchema.parse(JSON.parse(text));
}

/**
 * A parsed document serialises with its keys in
 * schema order whatever order they arrived in, so
 * a re-saved workflow diffs on the lines that
 * changed and nothing else.
 */
function documentText(ir: WorkflowIR): string {
  return `${JSON.stringify(ir, null, 2)}\n`;
}

export { withLock, STALE_LOCK_MS } from './lock.js';
export { writeFileAtomic } from './atomic-write.js';
export { diffSummary, DiffSummarySchema } from './diff.js';
export { HISTORY_LIMIT, listSnapshots, newestSnapshot } from './history.js';

/**
 * `writeProposal` and `supersede` stay inside this
 * module. Supersession is an invariant — one live
 * proposal per workflow — and a caller able to
 * write a proposal file directly could leave two
 * of them approvable.
 */
export {
  ProposalSchema,
  ProposalStatusSchema,
  WorkflowSpecSchema,
  listProposals,
  mintProposalId,
  readProposal,
} from './proposal.js';
export {
  MBOSS_DIRNAME,
  ProposalIdSchema,
  historyDir,
  historyFile,
  lockFile,
  manifestFile,
  mbossDirOf,
  proposalFile,
  proposalsDir,
  stateFile,
  workflowFile,
  workflowsDir,
} from './paths.js';

export type { AtomicWriteOptions } from './atomic-write.js';
export type { DiffSummary, Diffable } from './diff.js';
export type { ApplyError, Failure } from './errors.js';
export type { Snapshot } from './history.js';
export type {
  Proposal,
  ProposalStatus,
  WorkflowSpec,
  ParsedWorkflowSpec,
} from './proposal.js';
