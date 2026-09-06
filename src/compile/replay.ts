import type { WorkflowIR, WorkflowNode } from '../ir/index.js';

import { DEFAULT_RESENDS } from './emit-linear.js';
import {
  nameShape,
  ownerOf,
  recordedName,
  type RecordedSegment,
} from './names.js';
import {
  planWorkflow,
  type PlanArm,
  type PlanItem,
  type PlanRegion,
} from './plan.js';
import { UnsupportedIR } from './unsupported.js';

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

/**
 * Whether the run recorded below a point could
 * have been recorded by the document as it is now.
 *
 * DBOS compares the recorded name at each function
 * id when it replays, so a fork that copies rows
 * the current code would not write is a fork that
 * ends in an error the moment it runs. The only
 * evidence is the names in id order and the
 * drawing in front of somebody, so the question
 * has to be asked of the shapes rather than of the
 * values: what a predicate decided is not in the
 * ledger, and a run that took the other way out of
 * a branch recorded nothing to say so.
 *
 * That leaves three changes this cannot see, all
 * of them deliberate. A rewired condition below
 * the point goes unseen, but the forked run then
 * ends in an error carrying DBOS's own message,
 * which is loud rather than silent. A changed
 * handler body goes unseen by design; that is
 * what replaying is for. And a rewired input that
 * leaves the names alone changes nothing here
 * either.
 */

/**
 * One stretch of what a run writes, as the rows it
 * can write.
 *
 * A loop's body is built when a match reaches the
 * round rather than when the grammar is: a bound
 * is a number somebody typed on a canvas and
 * nothing caps it, while the rows to match it
 * against are always few.
 */
type Shape =
  | { kind: 'row'; name: string }
  /** `<prefix>[0]`, `[1]`, … for as many items as
   *  the list held, which no document says. */
  | { kind: 'items'; prefix: string }
  /** The run ends here. A way out wired to
   *  nothing returns, so nothing below it ran. */
  | { kind: 'stop' }
  | { kind: 'seq'; items: readonly Shape[] }
  | { kind: 'alt'; options: readonly Shape[] }
  | {
      kind: 'rounds';
      first: number;
      last: number;
      /** Whether every round runs, or the run may
       *  leave after any of them. */
      every: boolean;
      body: (round: number) => Shape;
    };

/**
 * What a document can record, in what order.
 *
 * Opaque: it is built from the same plan the
 * emitter writes from, and a second reading of it
 * anywhere else would be a second opinion about
 * what a workflow records. Ask it the two
 * questions below instead.
 */
export type TraceGrammar = { readonly root: Shape };

/**
 * Whether a run's rows are the beginning of
 * something the document could write, and where
 * the first disagreement is when they are not.
 *
 * `recorded` is empty where the run wrote no row
 * at all for that id.
 */
export type TraceMatch =
  | { ok: true }
  | { ok: false; at: number; recorded: string; expected: string[] };

const NO_ROWS: Shape = { kind: 'seq', items: [] };
const STOP: Shape = { kind: 'stop' };

function oneRow(name: string): Shape {
  return { kind: 'row', name };
}

function sequence(items: readonly Shape[]): Shape {
  return { kind: 'seq', items };
}

function either(options: readonly Shape[]): Shape {
  return { kind: 'alt', options };
}

/** The same stretch, or none of it. */
function perhaps(shape: Shape): Shape {
  return either([NO_ROWS, shape]);
}

/**
 * The park itself: `recv` reserves two ids and
 * records under both, its own row and the durable
 * sleep that times it out.
 */
const PARK: Shape = sequence([oneRow('DBOS.recv'), oneRow('DBOS.sleep')]);

/**
 * What a run of `ir` can record.
 *
 * A second reader of the emission plan beside the
 * emitter, and it mirrors it one item kind at a
 * time on purpose: a kind the emitter learns to
 * write that this does not describe fails a test
 * here rather than quietly widening what a fork
 * is offered for.
 */
export function traceGrammar(ir: WorkflowIR): TraceGrammar {
  return { root: regionShape(planWorkflow(ir).region, []) };
}

/**
 * Every shape of name the grammar can produce,
 * with the round numbers and item indexes it
 * cannot know reduced to `#`.
 *
 * The one thing about a grammar that is a fact
 * rather than an implementation detail, and the
 * side of the conformance check that has to be
 * compared against what the emitted file actually
 * writes.
 */
export function traceShapes(grammar: TraceGrammar): string[] {
  const found = new Set<string>();

  collectShapes(grammar.root, found);

  return [...found].sort();
}

function collectShapes(shape: Shape, into: Set<string>): void {
  switch (shape.kind) {
    case 'row':
      into.add(shapeOf(shape.name));
      return;

    case 'items':
      into.add(shapeOf(`${shape.prefix}[0]`));
      return;

    case 'stop':
      return;

    case 'seq':
      for (const item of shape.items) collectShapes(item, into);
      return;

    case 'alt':
      for (const option of shape.options) collectShapes(option, into);
      return;

    case 'rounds':
      // Every round writes the same shape, so one
      // of them says everything.
      collectShapes(shape.body(shape.first), into);
      return;
  }
}

/**
 * A row name with its numbers taken out. Read back
 * through the same parse that reads a real run, so
 * a name the grammar can write that nothing can
 * read back fails here.
 */
function shapeOf(name: string): string {
  const owner = ownerOf(name);

  return owner.kind === 'node' ? nameShape(owner.nodeId, owner.segments) : name;
}

/** One stretch of blocks, in the order a run takes
 *  them. */
function regionShape(region: PlanRegion, rounds: readonly number[]): Shape {
  return sequence(region.map((item) => itemShape(item, rounds)));
}

function itemShape(item: PlanItem, rounds: readonly number[]): Shape {
  switch (item.kind) {
    case 'blocks': {
      const body = sequence(
        item.group.nodes.map((node) => nodeShape(node, rounds)),
      );

      // A whole run of blocks behind one condition
      // either all ran or none of them did, and
      // the rows cannot say which.
      return item.group.guard === undefined ? body : perhaps(body);
    }

    case 'branch':
      return sequence([
        // A branch with no code of its own reads a
        // value somebody else bound, and records
        // nothing.
        item.node.handler === undefined
          ? NO_ROWS
          : oneRow(stepRow(item.node.id, rounds, [])),
        either(item.arms.map((arm) => armShape(arm, rounds))),
      ]);

    case 'approval':
      return sequence([
        oneRow(stepRow(item.node.id, rounds, [{ kind: 'ask' }])),
        waitShape(item.node.id, rounds, NO_ROWS),
        either(item.arms.map((arm) => armShape(arm, rounds))),
      ]);

    case 'countedLoop':
      return {
        kind: 'rounds',
        first: 1,
        last: item.rounds,
        every: true,
        body: (round) => regionShape(item.body, [...rounds, round]),
      };

    case 'repeat':
      return {
        kind: 'rounds',
        first: 1,
        last: item.rounds,
        every: false,
        body: (round) => regionShape(item.body, [...rounds, round]),
      };
  }
}

/** One way out of a branch or an approval. */
function armShape(arm: PlanArm, rounds: readonly number[]): Shape {
  const target = arm.target;

  switch (target.kind) {
    case 'end':
      return STOP;

    // Going round again, leaving the loop and
    // meeting the other ways out all record
    // nothing of their own. Which of them a run
    // took is exactly what the ledger does not
    // say, so every one of them stays alive.
    case 'again':
    case 'leave':
    case 'join':
      return NO_ROWS;

    case 'region':
      return target.outcome === 'ranOut'
        ? sequence([regionShape(target.region, rounds), STOP])
        : regionShape(target.region, rounds);
  }
}

function nodeShape(node: WorkflowNode, rounds: readonly number[]): Shape {
  switch (node.kind) {
    case 'step':
    case 'codeStep':
    case 'apiCall':
    case 'transaction':
      return node.forEach === undefined
        ? oneRow(stepRow(node.id, rounds, []))
        : { kind: 'items', prefix: stepRow(node.id, rounds, []) };

    case 'emailSend':
      return oneRow(stepRow(node.id, rounds, []));

    case 'durableWait':
      return node.config.source.kind === 'timer'
        ? oneRow('DBOS.sleep')
        : waitShape(node.id, rounds, resendShape(node, rounds, 1));

    default:
      // Not a refusal about the drawing: the
      // emitter refuses every kind it cannot
      // write, and one it can write that this does
      // not describe would silently let a fork be
      // offered past rows nobody accounted for.
      throw new UnsupportedIR(
        `this compiler cannot say what rows \`${node.id}\` records.`,
        node.id,
      );
  }
}

/** A run parking on somebody, and the row that
 *  says which run is parked. */
function waitShape(
  nodeId: string,
  rounds: readonly number[],
  resends: Shape,
): Shape {
  return sequence([
    oneRow(stepRow(nodeId, rounds, [{ kind: 'register' }])),
    PARK,
    resends,
    oneRow(stepRow(nodeId, rounds, [{ kind: 'clear' }])),
  ]);
}

/**
 * The reminders, each one numbered and each one
 * followed by another park.
 *
 * Nested rather than repeated so that a run which
 * sent one reminder cannot match the row the
 * second would have written: the counter is part
 * of the name, and that is the whole reason it is
 * there.
 */
function resendShape(
  node: Extract<WorkflowNode, { kind: 'durableWait' }>,
  rounds: readonly number[],
  count: number,
): Shape {
  if (count > resendLimit(node)) return NO_ROWS;

  return perhaps(
    sequence([
      oneRow(stepRow(node.id, rounds, [{ kind: 'resend', count }])),
      PARK,
      resendShape(node, rounds, count + 1),
    ]),
  );
}

/** How many reminders this wait can send, counted
 *  the way the emitter counts them. */
function resendLimit(
  node: Extract<WorkflowNode, { kind: 'durableWait' }>,
): number {
  const config = node.config;

  if (config.onTimeout !== 'resend') return 0;
  if (config.source.kind !== 'form') return 0;

  return config.maxResends ?? DEFAULT_RESENDS;
}

/**
 * What one row of a block is called here, with the
 * loops around it spelled out — the same order the
 * emitter writes them in, outermost first.
 */
function stepRow(
  nodeId: string,
  rounds: readonly number[],
  own: readonly RecordedSegment[],
): string {
  return recordedName(nodeId, [
    ...rounds.map((round) => ({ kind: 'round' as const, round })),
    ...own,
  ]);
}

/**
 * Whether the rows below `startStep` are the
 * beginning of a run `grammar` could produce.
 *
 * Every id from zero up has to be there. A hole is
 * a row the run has not written, which means it is
 * parked at it — and nothing below a park has run,
 * so no boundary lies past one.
 */
export function matchTrace(
  grammar: TraceGrammar,
  rows: readonly RecordedRow[],
  startStep: number,
): TraceMatch {
  const walk = new Walk(rows, Math.max(startStep, 0));
  const ends = walk.advance(grammar.root, new Set([0]));

  return walk.verdict(ends);
}

/**
 * One pass over a recording, as the set of places
 * the grammar could have got to.
 *
 * A set of places rather than a search that backs
 * up: every way out of a branch stays alive until
 * a name rules it out, which is many ways at once,
 * and places are bounded by the number of rows
 * where paths are not.
 */
class Walk {
  readonly #names: (string | undefined)[];
  readonly #end: number;

  /** What could have stood at each place, for
   *  saying what went wrong. */
  readonly #wanted = new Map<number, Set<string>>();

  constructor(rows: readonly RecordedRow[], end: number) {
    this.#end = end;
    this.#names = new Array<string | undefined>(end);

    for (const row of rows) {
      if (row.functionId >= 0 && row.functionId < end) {
        this.#names[row.functionId] = row.name;
      }
    }
  }

  /**
   * Every place the rows could stand after this
   * stretch has matched from each of `from`.
   *
   * The end of the recording absorbs: once the
   * rows have run out there is nothing left to
   * disagree with, which is what makes this a
   * question about a beginning rather than about a
   * whole run.
   */
  advance(shape: Shape, from: ReadonlySet<number>): Set<number> {
    switch (shape.kind) {
      case 'row':
        return this.#row(shape.name, from);

      case 'items':
        return this.#items(shape.prefix, from);

      case 'stop':
        return this.#spent(from);

      case 'seq': {
        let here = new Set(from);

        for (const item of shape.items) {
          if (here.size === 0) break;
          here = this.advance(item, here);
        }

        return here;
      }

      case 'alt': {
        const reached = new Set<number>();

        for (const option of shape.options) {
          for (const at of this.advance(option, from)) reached.add(at);
        }

        return reached;
      }

      case 'rounds':
        return shape.every
          ? this.#everyRound(shape, from)
          : this.#anyRound(shape, from);
    }
  }

  /** The answer, and what to say when it is no. */
  verdict(ends: ReadonlySet<number>): TraceMatch {
    if (ends.has(this.#end)) return { ok: true };

    // The furthest anything got: every way the
    // grammar could have gone died somewhere, and
    // the one that got closest is the one worth
    // telling somebody about. A place nothing was
    // wanted at is the grammar running out with
    // rows still to account for.
    const at = Math.max(0, ...this.#wanted.keys(), ...ends);

    return {
      ok: false,
      at,
      recorded: this.#names[at] ?? '',
      expected: [...(this.#wanted.get(at) ?? [])].sort(),
    };
  }

  #row(name: string, from: ReadonlySet<number>): Set<number> {
    const reached = new Set<number>();

    for (const at of from) {
      if (at >= this.#end) {
        reached.add(this.#end);
        continue;
      }

      this.#want(at, name);
      if (this.#names[at] === name) reached.add(at + 1);
    }

    return reached;
  }

  #items(prefix: string, from: ReadonlySet<number>): Set<number> {
    const reached = new Set<number>();

    for (const start of from) {
      if (start >= this.#end) {
        reached.add(this.#end);
        continue;
      }

      // Zero items is a list that was empty, which
      // a document never says it will not be.
      reached.add(start);

      let at = start;

      for (let index = 0; at < this.#end; index += 1) {
        const name = `${prefix}[${index}]`;

        this.#want(at, name);
        if (this.#names[at] !== name) break;

        at += 1;
        reached.add(at);
      }
    }

    return reached;
  }

  /** Only the places where the rows have run out:
   *  nothing may follow the run ending. */
  #spent(from: ReadonlySet<number>): Set<number> {
    const reached = new Set<number>();

    for (const at of from) if (at >= this.#end) reached.add(this.#end);

    return reached;
  }

  /**
   * A loop that runs a fixed number of rounds.
   *
   * A round that leaves the places it was given
   * unchanged is one that matched nothing, and
   * every round after it would do the same — which
   * is what stops a bound of a million rounds
   * being a million rounds of work.
   */
  #everyRound(
    shape: Extract<Shape, { kind: 'rounds' }>,
    from: ReadonlySet<number>,
  ): Set<number> {
    let here = new Set(from);

    for (const round of this.#roundNumbers(shape)) {
      const next = this.advance(shape.body(round), here);

      if (next.size === 0 || sameSet(next, here)) return next;
      here = next;
    }

    return here;
  }

  /** A loop a run may leave after any round, so
   *  every round's end is a place it could be. */
  #anyRound(
    shape: Extract<Shape, { kind: 'rounds' }>,
    from: ReadonlySet<number>,
  ): Set<number> {
    const reached = new Set<number>();
    let here = new Set(from);

    for (const round of this.#roundNumbers(shape)) {
      here = this.advance(shape.body(round), here);
      if (here.size === 0) break;

      const before = reached.size;

      for (const at of here) reached.add(at);
      if (reached.size === before) break;
    }

    return reached;
  }

  #roundNumbers(shape: Extract<Shape, { kind: 'rounds' }>): number[] {
    // A round only says something new by accounting
    // for a row, and there are only so many rows.
    const last = Math.min(shape.last, shape.first + this.#end);
    const numbers: number[] = [];

    for (let round = shape.first; round <= last; round += 1) {
      numbers.push(round);
    }

    return numbers;
  }

  #want(at: number, name: string): void {
    const names = this.#wanted.get(at);

    if (names === undefined) this.#wanted.set(at, new Set([name]));
    else names.add(name);
  }
}

/** Whether two sets of places hold the same ones. */
function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}
