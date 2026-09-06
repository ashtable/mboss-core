/**
 * What generated code calls things, and how a
 * recorded name is read back.
 *
 * Four jobs live here because all four have to
 * agree with each other: the identifier a workflow
 * function is exported under, the local a node's
 * result is bound to, the name a step is recorded
 * under, and the parse that says which block a
 * recorded row belongs to. The recorded name is
 * not cosmetic — DBOS compares it at each function
 * id when it replays a run, and a name that moves
 * turns every recovery into an error days after
 * the change that caused it. Keeping the parse
 * beside the rendering is what makes a new segment
 * kind fail a test here instead of silently
 * misattributing rows wherever a run is read.
 *
 * This module imports nothing, so the browser
 * bundles that draw a run can carry it whole.
 */

/**
 * `groom_booking` becomes `groomBooking`. Only the
 * identifier changes: the name a workflow
 * registers under stays the snake_case IR name,
 * because that is the spelling the ingress route
 * and anything enqueuing by name already knows.
 */
export function camelCase(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((word, index) =>
      index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join('');
}

/**
 * Every binding a generated workflow body holds,
 * so no two of them can be the same word.
 *
 * The reserved set starts with the imports, since
 * a local named after the handler it calls would
 * shadow it — the call would then be a recursive
 * reference to a `const` in its own initialiser,
 * which is a runtime error rather than a compile
 * one.
 */
export class LocalNames {
  readonly #taken: Set<string>;
  readonly #byNode = new Map<string, string>();

  constructor(reserved: readonly string[]) {
    this.#taken = new Set(reserved);
  }

  /** The local a node's result is bound to. */
  forNode(nodeId: string): string {
    const existing = this.#byNode.get(nodeId);
    if (existing !== undefined) return existing;

    const name = this.take(`${camelCase(nodeId)}Out`);
    this.#byNode.set(nodeId, name);

    return name;
  }

  /**
   * Whether a name is already spoken for.
   *
   * Asked before a handler is imported: the file
   * declares the workflow under the camelCase of
   * its own name, and one file cannot both import
   * and declare a single identifier.
   */
  has(name: string): boolean {
    return this.#taken.has(name);
  }

  /**
   * A temporary, under the name asked for when it
   * is free and a numbered one when it is not.
   */
  take(preferred: string): string {
    if (!this.#taken.has(preferred)) {
      this.#taken.add(preferred);
      return preferred;
    }

    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${preferred}${suffix}`;

      if (!this.#taken.has(candidate)) {
        this.#taken.add(candidate);
        return candidate;
      }
    }
  }
}

/**
 * One enclosing region of a step, as it appears in
 * the step's recorded name.
 *
 * Every variable named here is derived from
 * checkpointed control flow — a loop counter, a
 * chunk offset — and never from a clock or a
 * random value, which is what makes the name the
 * same on a replay as it was on the first run.
 */
export type StepSegment =
  | { kind: 'round'; name: string }
  | { kind: 'item' }
  /** The row that says which run is parked here. */
  | { kind: 'register' }
  /** Deleting that row once the run wakes. */
  | { kind: 'clear' }
  /** The mail an approval asks its question in. */
  | { kind: 'ask' }
  /** One reminder, counted so two are two names. */
  | { kind: 'resend'; counter: string };

/**
 * The source text of a step's `name` option: a
 * plain string when the step runs once, a template
 * literal when it runs inside a region that
 * numbers it.
 */
export function stepNameLiteral(
  nodeId: string,
  segments: readonly StepSegment[],
): string {
  const tail = segments.map(segmentText).join('');
  const name = `${nodeId}${tail}`;

  // Quoted rather than a template unless something
  // in it is filled in at run time: prettier
  // rewrites a template with no holes back to a
  // plain string, and the emitted file has to
  // already be formatted.
  return tail.includes('${') ? `\`${name}\`` : `'${name}'`;
}

function segmentText(segment: StepSegment): string {
  switch (segment.kind) {
    case 'round':
      return `.r\${${segment.name}}`;

    case 'item':
      return '[${offset + index}]';

    case 'register':
      return '.register';

    case 'clear':
      return '.clear';

    case 'ask':
      return '.ask';

    case 'resend':
      return `.resend.\${${segment.counter}}`;
  }
}

/**
 * The same six regions, read back off a row that
 * was recorded.
 *
 * `StepSegment` carries the variable a template
 * names; this carries the value that variable was
 * filled with. `.r${round}` is rendered from the
 * first and parsed into the second, so the two
 * cannot be one type however alike they look.
 */
export type RecordedSegment =
  | { kind: 'round'; round: number }
  | { kind: 'item'; index: number }
  | { kind: 'register' }
  | { kind: 'clear' }
  | { kind: 'ask' }
  | { kind: 'resend'; count: number };

/**
 * The name a run would write for one step, with
 * the values filled in.
 *
 * `stepNameLiteral` renders the template the
 * emitter writes and `ownerOf` reads a row back;
 * this renders the row itself, which is what
 * anything predicting a run rather than reading
 * one needs.
 */
export function recordedName(
  nodeId: string,
  segments: readonly RecordedSegment[],
): string {
  return `${nodeId}${segments.map(recordedText).join('')}`;
}

function recordedText(segment: RecordedSegment): string {
  switch (segment.kind) {
    case 'round':
      return `.r${segment.round}`;

    case 'item':
      return `[${segment.index}]`;

    case 'register':
      return '.register';

    case 'clear':
      return '.clear';

    case 'ask':
      return '.ask';

    case 'resend':
      return `.resend.${segment.count}`;
  }
}

/**
 * The same name with every filled-in value reduced
 * to `#`, so `find_slot.r1` and `find_slot.r2` are
 * one thing.
 *
 * It takes the regions rather than the values
 * because either kind of segment answers it: a
 * template the emitter wrote and a row a run wrote
 * describe the same region, and comparing the two
 * is the whole point — a round is a round whether
 * the name spells it `${round}` or `2`.
 */
export function nameShape(
  nodeId: string,
  segments: readonly { kind: RecordedSegment['kind'] }[],
): string {
  return `${nodeId}${segments.map((segment) => shapeText(segment.kind)).join('')}`;
}

function shapeText(kind: RecordedSegment['kind']): string {
  switch (kind) {
    case 'round':
      return '.r#';

    case 'item':
      return '[#]';

    case 'register':
      return '.register';

    case 'clear':
      return '.clear';

    case 'ask':
      return '.ask';

    case 'resend':
      return '.resend.#';
  }
}

/**
 * Who a recorded row belongs to.
 *
 * `unknown` keeps the name rather than throwing it
 * away: one ledger holds every workflow an app
 * runs, including hand-written ones this compiler
 * never saw, and a reader has to be able to say so
 * rather than guess or fail.
 */
export type Owner =
  | { kind: 'node'; nodeId: string; segments: RecordedSegment[] }
  | { kind: 'sdk'; name: string }
  | { kind: 'unknown'; name: string };

/**
 * Every name the SDK reserves for a primitive of
 * its own, so a row carrying one is never read as
 * a block that happens to share the spelling.
 *
 * `getStatus` is the odd one out and the only
 * reason a set is needed at all: it is the one
 * primitive the SDK records without the prefix,
 * and read syntactically it is a plausible node
 * name.
 */
export const SDK_OPERATIONS: ReadonlySet<string> = new Set([
  'DBOS.send',
  'DBOS.recv',
  'DBOS.setEvent',
  'DBOS.getEvent',
  'DBOS.sleep',
  'DBOS.getResult',
  'DBOS.writeStream',
  'DBOS.closeStream',
  'DBOS.readStream',
  'DBOS.readStreamOffset',
  'getStatus',
]);

// Checked on its own as well as against the set,
// so a primitive a later SDK adds still reads as
// the SDK's without this file changing. No block
// can answer to it: a node id is lowercase.
const SDK_PREFIX = 'DBOS.';

// The node id's own shape, restated rather than
// imported because this module imports nothing.
// What the parse leans on is that an id admits
// neither `.` nor `[`, so it always ends exactly
// where the first segment begins.
const NODE_ID = /^[a-z][a-z0-9_]{0,40}/;

// One region of the tail. The three kinds that
// carry a value capture it; the three that do not
// are told apart by the text they matched. `.r`
// wants a digit next, which is what stops it
// swallowing the front of `.register` and
// `.resend`.
const SEGMENT =
  /^(?:\[(\d+)\]|\.r(\d+)|\.resend\.(\d+)|\.register|\.clear|\.ask)/;

/** One matched region, as the value it recorded. */
function parseSegment(match: RegExpExecArray): RecordedSegment {
  const [text, index, round, count] = match;

  if (index !== undefined) return { kind: 'item', index: Number(index) };
  if (round !== undefined) return { kind: 'round', round: Number(round) };
  if (count !== undefined) return { kind: 'resend', count: Number(count) };
  if (text === '.register') return { kind: 'register' };
  if (text === '.clear') return { kind: 'clear' };

  // The alternation admits nothing else.
  return { kind: 'ask' };
}

/**
 * Every region of what follows a node id, or
 * `null` if any of it is not a region this
 * emitter renders.
 */
function parseSegments(tail: string): RecordedSegment[] | null {
  const segments: RecordedSegment[] = [];
  let rest = tail;

  while (rest.length > 0) {
    const match = SEGMENT.exec(rest);
    if (match === null) return null;

    segments.push(parseSegment(match));
    rest = rest.slice(match[0].length);
  }

  return segments;
}

/**
 * Which block, if any, a recorded row belongs to.
 *
 * Syntactic and never throwing, because it is
 * handed names off a ledger rather than out of a
 * document: it decides from the name alone, and
 * whether the block it names still exists is a
 * separate question for whoever holds the
 * workflow.
 */
export function ownerOf(name: string): Owner {
  if (name.startsWith(SDK_PREFIX) || SDK_OPERATIONS.has(name))
    return { kind: 'sdk', name };

  const nodeId = NODE_ID.exec(name)?.[0];
  if (nodeId === undefined) return { kind: 'unknown', name };

  const segments = parseSegments(name.slice(nodeId.length));
  if (segments === null) return { kind: 'unknown', name };

  return { kind: 'node', nodeId, segments };
}

// The two ways a name literal spells a value: a
// hole the run fills in, or a number somebody
// already filled in. Reading both is what lets a
// name the emitter wrote and a name a run wrote be
// compared with each other.
const VALUE = String.raw`(?:\d+|\$\{[^}]*\})`;
const LITERAL_SEGMENT = new RegExp(
  `^(?:\\[${VALUE}\\]|\\.resend\\.${VALUE}|\\.r${VALUE}|` +
    `\\.register|\\.clear|\\.ask)`,
);

/**
 * One recorded-name literal as the shape of row it
 * writes: `` `find_slot.r${round}` `` and
 * `'find_slot.r2'` are both `find_slot.r#`.
 *
 * The inverse of `stepNameLiteral`, and here for
 * the same reason the recorded parse is: a region
 * added to one of them has to be added to the
 * other, and the two only stay in step if changing
 * one puts the other in front of whoever changed
 * it.
 *
 * Read region by region rather than by blanking
 * out the holes, so a literal carrying something
 * this emitter does not write fails to be read
 * rather than comparing equal to something that
 * does. What it cannot read comes back unchanged,
 * which fails the comparison this exists for
 * instead of passing quietly as something else.
 */
export function nameLiteralShape(literal: string): string {
  const text = unquoted(literal);
  const nodeId = NODE_ID.exec(text)?.[0];

  if (nodeId === undefined) return literal;

  const segments = literalSegments(text.slice(nodeId.length));

  return segments === null ? literal : nameShape(nodeId, segments);
}

/** The literal without whichever quote opened it.
 *  A row the SDK named carries none. */
function unquoted(literal: string): string {
  const quote = literal[0];

  if (quote !== "'" && quote !== '`') return literal;
  if (!literal.endsWith(quote)) return literal;

  return literal.slice(1, -1);
}

/**
 * Every region of what follows a node id, or
 * `null` when any of it is not a region this
 * emitter writes.
 */
function literalSegments(
  tail: string,
): { kind: RecordedSegment['kind'] }[] | null {
  const segments: { kind: RecordedSegment['kind'] }[] = [];
  let rest = tail;

  while (rest.length > 0) {
    const match = LITERAL_SEGMENT.exec(rest);
    if (match === null) return null;

    segments.push({ kind: segmentKind(match[0]) });
    rest = rest.slice(match[0].length);
  }

  return segments;
}

/**
 * Which region one matched piece is. `.register`
 * and `.resend` are asked about before the round,
 * because all three open `.r` and reading a wait's
 * row as a loop's would put them in the same
 * place.
 */
function segmentKind(text: string): RecordedSegment['kind'] {
  if (text.startsWith('[')) return 'item';
  if (text.startsWith('.resend.')) return 'resend';
  if (text.startsWith('.register')) return 'register';
  if (text.startsWith('.clear')) return 'clear';
  if (text.startsWith('.ask')) return 'ask';

  return 'round';
}
