import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';

import { writeFileAtomic } from './atomic-write.js';
import { hasCode } from './fs-error.js';
import { WORKFLOW_SUFFIX, historyDir, historyFile } from './paths.js';

/**
 * The workflow as it was before each apply, kept
 * so that an edit can be taken back.
 *
 * A snapshot is the whole document, not a diff:
 * documents are small, and a chain of diffs is
 * only as good as its weakest link, where a
 * complete copy either reads back or does not.
 */

/**
 * How many snapshots a workflow keeps.
 *
 * Undo is for the edit that just went wrong, not
 * for archaeology — the history directory is
 * gitignored and git is where a project's real
 * past lives.
 */
export const HISTORY_LIMIT = 20;

/**
 * A snapshot and where it came from. The path
 * comes along because undo consumes the snapshot
 * it restores.
 */
export type Snapshot = { path: string; ir: WorkflowIR };

/**
 * Files the document away and prunes the workflow's
 * oldest snapshots past the limit.
 *
 * Pruning is per workflow rather than across the
 * directory, so a workflow being edited hard
 * cannot spend another workflow's undo history.
 */
export async function snapshot(
  mbossDir: string,
  ir: WorkflowIR,
): Promise<void> {
  await mkdir(historyDir(mbossDir), { recursive: true });
  await writeFileAtomic(
    freePath(mbossDir, ir),
    `${JSON.stringify(ir, null, 2)}\n`,
  );
  await prune(mbossDir, ir.name);
}

/**
 * A workflow's snapshots, oldest first.
 *
 * An unreadable one is skipped rather than raised:
 * `history/` is derived and gitignored, so a file
 * left by an older build is one fewer step of undo,
 * not a reason to stop.
 */
export async function listSnapshots(
  mbossDir: string,
  name: string,
): Promise<Snapshot[]> {
  const dir = historyDir(mbossDir);
  const found: Snapshot[] = [];

  for (const file of await snapshotFiles(mbossDir, name)) {
    const path = join(dir, file);
    const ir = parseDocument(await readFile(path, 'utf8'));

    if (ir !== undefined) found.push({ path, ir });
  }

  return found;
}

/**
 * The document as it was before the most recent
 * apply — what an undo restores.
 */
export async function newestSnapshot(
  mbossDir: string,
  name: string,
): Promise<Snapshot | undefined> {
  return (await listSnapshots(mbossDir, name)).at(-1);
}

/**
 * A file name no snapshot has taken yet.
 *
 * Two applies inside the same millisecond would
 * otherwise name the same file and the second
 * would erase the first, so the stamp walks
 * forward to the next free millisecond. Stepping
 * the stamp rather than adding a suffix keeps
 * every name the same width, which is what lets
 * sorting names sort them by age.
 */
function freePath(mbossDir: string, ir: WorkflowIR): string {
  for (let ms = Date.now(); ; ms += 1) {
    const path = historyFile(mbossDir, stampOf(new Date(ms)), ir.name);

    if (!existsSync(path)) return path;
  }
}

/**
 * An ISO instant with the characters a file name
 * cannot portably carry replaced.
 */
function stampOf(at: Date): string {
  return at.toISOString().replace(/[:.]/g, '-');
}

async function prune(mbossDir: string, name: string): Promise<void> {
  const files = await snapshotFiles(mbossDir, name);
  const excess = files.length - HISTORY_LIMIT;

  for (const file of files.slice(0, Math.max(excess, 0))) {
    await rm(join(historyDir(mbossDir), file), { force: true });
  }
}

/**
 * One workflow's snapshot file names, oldest first.
 *
 * The suffix match is unambiguous because a
 * workflow name cannot contain a hyphen, so the
 * hyphen this looks for can only be the one
 * written between the stamp and the name.
 */
async function snapshotFiles(
  mbossDir: string,
  name: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(historyDir(mbossDir));
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return [];
    throw error;
  }

  const suffix = `-${name}${WORKFLOW_SUFFIX}`;

  return entries.filter((entry) => entry.endsWith(suffix)).sort();
}

function parseDocument(text: string): WorkflowIR | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  const parsed = WorkflowIRSchema.safeParse(json);

  return parsed.success ? parsed.data : undefined;
}
