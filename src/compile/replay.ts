import type { WorkflowIR, WorkflowNode } from '../ir/index.js';

import { ownerOf, type RecordedSegment } from './names.js';

/**
 * Which points of a recorded run a person may
 * start a replay from, and why the rest are not on
 * offer.
 *
 * A run is the list of rows the SDK checkpointed
 * as it went, and replaying means beginning again
 * from one of them with everything before it
 * reused. Most rows are a fine place to begin. The
 * few that are not each have a reason a person can
 * act on — a link that has to be minted again, a
 * run that is still sitting where you clicked — so
 * both lists come back rather than one, and an
 * editor can say why a row has no button instead
 * of leaving a gap.
 *
 * `ownerOf` is the only thing here that reads a
 * recorded name. Every rule below is asked of the
 * block the name resolved to, so a segment the
 * emitter starts writing fails the grammar's own
 * tests rather than quietly landing rows on the
 * wrong block.
 *
 * Pure. Whether the run exists, whether the
 * document still describes it, and what replaying
 * actually does are all somebody else's.
 */

/** One row the SDK recorded for a run. */
export type RecordedRow = {
  functionId: number;
  name: string;

  /** Absent while the row is still open. */
  completedAt: number | undefined;
  failed: boolean;
};

/** A point a replay may start from. */
export type ReplayBoundary = {
  functionId: number;
  nodeId: string;

  /** What to call the point: the block's title,
   *  and the round, item or wait row it names. */
  label: string;

  /** The block's own default, for when a person
   *  picked the block rather than one of its
   *  rows. */
  preferred: boolean;
};

/**
 * A row that is not on offer, and what to say
 * about it.
 *
 * No block id: the reason belongs to the row, and
 * the block it sits under is the caller's to draw.
 */
export type Unoffered = {
  functionId: number;
  because: 'sdk-owned' | 'inside-wait' | 'link-scoped' | 'parked-here';

  /** For `link-scoped`, the block to replay from
   *  instead. An id rather than a title, because
   *  two blocks may share a title. */
  instead?: string;
};

// Between a block's title and the region of it a
// row names.
const SEPARATOR = ' · ';

/** How one recorded region reads to a person. */
function segmentLabel(segment: RecordedSegment): string {
  switch (segment.kind) {
    case 'round':
      return `round ${segment.round}`;

    case 'item':
      return `item ${segment.index}`;

    case 'register':
      return 'register';

    case 'clear':
      return 'clear';

    case 'ask':
      return 'ask';

    case 'resend':
      return `resend ${segment.count}`;
  }
}

function labelOf(
  node: WorkflowNode,
  segments: readonly RecordedSegment[],
): string {
  return [node.title, ...segments.map(segmentLabel)].join(SEPARATOR);
}

/**
 * Why a row of this block is withheld, or `null`
 * when it is on offer.
 *
 * Only the last region decides: a row is `.r2` of
 * a wait's register or `.r2` of its clear, and
 * which of the two it is, is the whole question.
 */
function withholding(
  node: WorkflowNode,
  segments: readonly RecordedSegment[],
): Omit<Unoffered, 'functionId'> | null {
  const region = segments.at(-1)?.kind;

  // Beginning again at the row that clears the
  // correlation would hand the new run an answer
  // that came back for the old one, and beginning
  // at a reminder would send a link that reaches
  // neither.
  if (region === 'clear' || region === 'resend') {
    return { because: 'inside-wait' };
  }

  // A form's link names the run it was minted
  // for. Only the email can mint another, so the
  // wait sends a person one block back rather than
  // offering a park nobody can answer. An event
  // wait carries no link and is offered as it is.
  if (region === 'register' && node.kind === 'durableWait') {
    const { source } = node.config;

    if (source.kind === 'form') {
      return { because: 'link-scoped', instead: source.email };
    }
  }

  return null;
}

/**
 * Whether a row is where the run is now rather
 * than somewhere behind it.
 *
 * A failed row has no completion time either, and
 * it is the one row the failure-fix-replay story
 * most wants to resume from — so the two are asked
 * separately.
 */
function unfinished(row: RecordedRow): boolean {
  return !row.failed && row.completedAt === undefined;
}

/**
 * Whether `candidate` is the better default for
 * its block than the one held so far: a row that
 * failed beats one that did not, and otherwise the
 * earlier row wins.
 */
function beats(candidate: RecordedRow, held: RecordedRow | undefined): boolean {
  if (held === undefined) return true;
  if (candidate.failed !== held.failed) return candidate.failed;

  return candidate.functionId < held.functionId;
}

/**
 * The one row per block that a replay starts from
 * when a person picked the block itself.
 *
 * Chosen from the rows on offer, never from all of
 * them: a default nobody can click is not a
 * default.
 */
function defaultsByNode(
  offerable: readonly { nodeId: string; row: RecordedRow }[],
): Set<number> {
  const best = new Map<string, RecordedRow>();

  for (const { nodeId, row } of offerable) {
    if (beats(row, best.get(nodeId))) best.set(nodeId, row);
  }

  return new Set([...best.values()].map((row) => row.functionId));
}

/**
 * Every point in `rows` a replay of `ir` may start
 * from, and every point it may not.
 *
 * A row that names no block in this document is in
 * neither list. A run outlives the document it was
 * compiled from — a block gets renamed, a block
 * gets deleted, and one ledger holds workflows
 * this compiler never wrote — and there is nothing
 * useful to say to a person about a block that is
 * not in front of them.
 */
export function replayBoundaries(
  ir: WorkflowIR,
  rows: readonly RecordedRow[],
): { offered: ReplayBoundary[]; unoffered: Unoffered[] } {
  const nodes = new Map(ir.nodes.map((node) => [node.id, node]));
  const offerable: { nodeId: string; label: string; row: RecordedRow }[] = [];
  const unoffered: Unoffered[] = [];

  for (const row of rows) {
    // Asked first, and of every open row rather
    // than only the newest: the frontier is where
    // a parked run sits, a fan-out can leave
    // siblings open beside it, and neither is
    // behind the run. That the run is still there
    // is also more use to a person than knowing
    // the SDK owns the row it is waiting in.
    if (unfinished(row)) {
      unoffered.push({ functionId: row.functionId, because: 'parked-here' });
      continue;
    }

    const owner = ownerOf(row.name);

    if (owner.kind === 'sdk') {
      unoffered.push({ functionId: row.functionId, because: 'sdk-owned' });
      continue;
    }

    if (owner.kind === 'unknown') continue;

    const node = nodes.get(owner.nodeId);
    if (node === undefined) continue;

    const withheld = withholding(node, owner.segments);

    if (withheld !== null) {
      unoffered.push({ functionId: row.functionId, ...withheld });
      continue;
    }

    offerable.push({
      nodeId: node.id,
      label: labelOf(node, owner.segments),
      row,
    });
  }

  const defaults = defaultsByNode(offerable);

  return {
    offered: offerable.map(({ nodeId, label, row }) => ({
      functionId: row.functionId,
      nodeId,
      label,
      preferred: defaults.has(row.functionId),
    })),
    unoffered,
  };
}
