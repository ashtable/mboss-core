import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { WorkflowIRSchema, WorkflowNameSchema } from '../ir/index.js';
import { DiagnosticSchema } from '../validate/index.js';

import { writeFileAtomic } from './atomic-write.js';
import { DiffSummarySchema } from './diff.js';
import { hasCode } from './fs-error.js';
import {
  PROPOSAL_SUFFIX,
  ProposalIdSchema,
  proposalFile,
  proposalsDir,
} from './paths.js';

/**
 * A proposal: an edit an agent wants to make,
 * written down and not yet made.
 *
 * It is a file rather than a message because the
 * canvas may not be running. When it is, its
 * watcher draws the proposal as a preview within a
 * file event of the write; when it is not, the
 * agent presents the same summary as text in a
 * terminal. Same data, two presentations, and no
 * process has to be alive for the other to work.
 */

/**
 * A spec is the full desired workflow, never a
 * patch.
 *
 * Full-document semantics because it is what an
 * agent can get right: describing the workflow it
 * wants is one statement that either validates or
 * does not, where a sequence of patch operations
 * has an order, a half-applied middle, and a
 * different meaning depending on what it was
 * applied to. This module computes the diff, so
 * nothing is lost by it.
 *
 * The envelope fields are omitted rather than
 * accepted and ignored: `revision` is the apply
 * engine's to set, `$schema` and `version` say
 * what format the file is in, and `name` comes
 * from the caller's argument — a spec carrying its
 * own could disagree with the file it is being
 * written to.
 */
export const WorkflowSpecSchema = WorkflowIRSchema.omit({
  $schema: true,
  version: true,
  revision: true,
  name: true,
});

/**
 * Where a proposal is in its life. `discarded`
 * covers both ways one ends without being applied:
 * a person declined it, or a newer proposal for
 * the same workflow replaced it.
 */
export const ProposalStatusSchema = z.enum([
  'proposed',
  'applied',
  'discarded',
]);

/**
 * `baseRevision` is nullable because a proposal
 * may be for a workflow that does not exist yet,
 * and `diagnostics` is stored rather than
 * recomputed on read so that the preview a person
 * approves is the one the agent was shown.
 */
export const ProposalSchema = z.object({
  id: ProposalIdSchema,
  workflow: WorkflowNameSchema,
  baseRevision: z.number().int().nullable(),
  spec: WorkflowSpecSchema,
  summary: DiffSummarySchema,
  diagnostics: z.array(DiagnosticSchema),
  proposedBy: z.string(),
  createdAt: z.iso.datetime(),
  status: ProposalStatusSchema,
});

/**
 * A spec as a caller writes one. The input type
 * rather than the output type, because the fields
 * that carry defaults — an edge's `port` and
 * `back` — are exactly the fields a caller should
 * be able to leave out.
 */
export type WorkflowSpec = z.input<typeof WorkflowSpecSchema>;

/**
 * A spec after parsing, which is the shape stored
 * in a proposal file.
 */
export type ParsedWorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;

/**
 * Mints an id.
 *
 * The minting time leads so that a directory
 * listing is in age order, and the random tail is
 * there because two agents proposing in the same
 * millisecond must not name the same file.
 */
export function mintProposalId(): string {
  return `prop_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/**
 * Writes a proposal, replacing any earlier version
 * of it.
 *
 * Parsed on the way out: another process reads this
 * file and parses it, and a writer that skipped
 * the check would push its own bug across the
 * process boundary to be found there.
 */
export async function writeProposal(
  mbossDir: string,
  proposal: Proposal,
): Promise<void> {
  const checked = ProposalSchema.parse(proposal);

  await mkdir(proposalsDir(mbossDir), { recursive: true });
  await writeFileAtomic(
    proposalFile(mbossDir, checked.id),
    `${JSON.stringify(checked, null, 2)}\n`,
  );
}

/**
 * Reads one proposal, or reports that there is
 * none by that id.
 *
 * Unlike a workflow document, an unreadable
 * proposal is not an error: `proposals/` is
 * derived and gitignored, so a file left there by
 * an older build or half-written by a killed
 * process means "no such proposal", not "stop".
 * An id that this module could never have minted
 * gets the same answer without a filesystem call —
 * it names a path, and a path is not somewhere a
 * caller's string may wander.
 */
export async function readProposal(
  mbossDir: string,
  id: string,
): Promise<Proposal | undefined> {
  if (!ProposalIdSchema.safeParse(id).success) return undefined;

  let text: string;
  try {
    text = await readFile(proposalFile(mbossDir, id), 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }

  return parseProposal(text);
}

/**
 * Every proposal in the project, oldest first —
 * ids begin with their minting time, so sorting
 * the file names sorts by age.
 */
export async function listProposals(mbossDir: string): Promise<Proposal[]> {
  const dir = proposalsDir(mbossDir);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return [];
    throw error;
  }

  const found: Proposal[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(PROPOSAL_SUFFIX)) continue;

    const proposal = parseProposal(await readFile(join(dir, entry), 'utf8'));
    if (proposal !== undefined) found.push(proposal);
  }

  return found;
}

/**
 * Discards the workflow's other outstanding
 * proposals.
 *
 * One workflow has at most one live proposal
 * because a canvas can only draw one preview and a
 * person can only approve what they were shown. An
 * agent that proposes twice has changed its mind,
 * and the first proposal — whose `baseRevision`
 * still passes — would otherwise stay approvable
 * and quietly undo the second.
 */
export async function supersede(
  mbossDir: string,
  workflow: string,
  keepId: string,
): Promise<void> {
  for (const proposal of await listProposals(mbossDir)) {
    if (proposal.workflow !== workflow) continue;
    if (proposal.id === keepId) continue;
    if (proposal.status !== 'proposed') continue;

    await writeProposal(mbossDir, { ...proposal, status: 'discarded' });
  }
}

function parseProposal(text: string): Proposal | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  const parsed = ProposalSchema.safeParse(json);

  return parsed.success ? parsed.data : undefined;
}
