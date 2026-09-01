import { join } from 'node:path';

import { z } from 'zod';

import { WorkflowNameSchema } from '../ir/index.js';

/**
 * Every path inside a project's `.mboss/`
 * directory, written down once.
 *
 * The layout of that directory is a contract
 * between the canvas, the MCP server and this
 * module — three of them holding their own copy
 * of `join('.mboss', 'workflows', …)` is how the
 * three drift apart.
 */

/**
 * The control directory's name. A project is an
 * mBoss project exactly when this directory is
 * there.
 */
export const MBOSS_DIRNAME = '.mboss';

/**
 * Workflow documents and their history snapshots
 * share a suffix because a snapshot is the same
 * document, taken earlier.
 */
export const WORKFLOW_SUFFIX = '.workflow.json';

export const PROPOSAL_SUFFIX = '.proposal.json';

/**
 * A proposal id, `prop_<minted-at>_<random>`.
 *
 * The format is pinned here rather than beside the
 * proposal schema because the id is used as a file
 * name: an id carrying a slash or a `..` would
 * name a path outside `proposals/`.
 */
export const ProposalIdSchema = z.string().regex(/^prop_\d+_[0-9a-f]+$/);

/**
 * The control directory of a project rooted at
 * `projectDir`. Everything else here takes that
 * directory rather than the project, so a caller
 * that already found it never has to find it
 * twice.
 */
export function mbossDirOf(projectDir: string): string {
  return join(projectDir, MBOSS_DIRNAME);
}

export function workflowsDir(mbossDir: string): string {
  return join(mbossDir, 'workflows');
}

/**
 * Where a workflow lives. The name is parsed on
 * the way through, so no caller can turn a name it
 * did not check into a path outside `workflows/`.
 */
export function workflowFile(mbossDir: string, name: string): string {
  const safe = WorkflowNameSchema.parse(name);

  return join(workflowsDir(mbossDir), `${safe}${WORKFLOW_SUFFIX}`);
}

export function proposalsDir(mbossDir: string): string {
  return join(mbossDir, 'proposals');
}

export function proposalFile(mbossDir: string, id: string): string {
  const safe = ProposalIdSchema.parse(id);

  return join(proposalsDir(mbossDir), `${safe}${PROPOSAL_SUFFIX}`);
}

export function historyDir(mbossDir: string): string {
  return join(mbossDir, 'history');
}

/**
 * A pre-apply snapshot. The stamp leads so that
 * the directory listing is already in age order,
 * and the name follows so that one workflow's
 * history can be picked out of it.
 */
export function historyFile(
  mbossDir: string,
  stamp: string,
  name: string,
): string {
  const safe = WorkflowNameSchema.parse(name);

  return join(historyDir(mbossDir), `${stamp}-${safe}${WORKFLOW_SUFFIX}`);
}

/**
 * The MCP bundle a consumer drops in. `mboss-core`
 * cannot produce those bytes — they are built in
 * the MCP server's own CI and shipped inside the
 * extension — so a fresh project gets the
 * directory and a note saying where the bundle
 * comes from.
 */
export function mcpDir(mbossDir: string): string {
  return join(mbossDir, 'mcp');
}

/**
 * The agent-skills slot beside it, filled from the
 * same place and empty until then.
 */
export function skillsDir(mbossDir: string): string {
  return join(mbossDir, 'skills');
}

/**
 * The code-behind conventions, written once when
 * the project is created. It is the project's own
 * document from then on, so nothing regenerates
 * it.
 */
export function conventionsFile(mbossDir: string): string {
  return join(mbossDir, 'conventions.md');
}

/**
 * The derived `/lib` manifest cache. Gitignored: it
 * is a cache of the code beside it.
 */
export function manifestFile(mbossDir: string): string {
  return join(mbossDir, 'manifest.json');
}

/**
 * The editor's hint file, `{ activeWorkflow }`.
 * Nothing depends on it existing — it is how a
 * running canvas tells a headless tool which
 * workflow the person is looking at.
 */
export function stateFile(mbossDir: string): string {
  return join(mbossDir, 'state.json');
}

/**
 * The advisory write lock. Every writer of a
 * workflow document — the canvas, the MCP server,
 * codegen — holds this one file, which is the only
 * reason two of them cannot lose each other's
 * edits.
 */
export function lockFile(mbossDir: string): string {
  return join(mbossDir, '.lock');
}
