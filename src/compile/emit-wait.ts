import { expandedCall, writeThrow } from './emit-control.js';
import { literal } from './predicate.js';
import type { SourceWriter } from './source.js';

/**
 * How a run parks, and how a value the runtime
 * reads reaches the page.
 *
 * Nothing here knows what a workflow document is.
 * It is handed the pieces already worked out and
 * writes the statements in the order they have to
 * come in — the row before the park, the clearing
 * after it, the question about what arrived last of
 * all. That order is the whole of the correctness
 * here and it is invisible to both a type-check and
 * a golden, so it is asserted directly.
 */

/** One entry of an object being written out. */
export type EmittedEntry = {
  key: string;
  /** Absent where the key names a binding already
   *  in scope, which is written as shorthand. */
  value?: Emitted;
};

/** A value, as the source that produces it. */
export type Emitted =
  | { kind: 'source'; text: string }
  | { kind: 'text'; value: string }
  | { kind: 'object'; entries: readonly EmittedEntry[] }
  | { kind: 'list'; items: readonly Emitted[] }
  | { kind: 'call'; callee: string; argument: Emitted };

export function source(text: string): Emitted {
  return { kind: 'source', text };
}

/**
 * Words somebody wrote, as a string literal.
 *
 * Kept apart from `source` because prose is the
 * one value here that can be broken across lines
 * without inventing anything: an email body runs
 * past the width on its second sentence, and a sum
 * of shorter pieces says exactly what the one long
 * literal said.
 */
export function text(value: string): Emitted {
  return { kind: 'text', value };
}

export function object(entries: readonly EmittedEntry[]): Emitted {
  return { kind: 'object', entries };
}

export function list(items: readonly Emitted[]): Emitted {
  return { kind: 'list', items };
}

export function call(callee: string, argument: Emitted): Emitted {
  return { kind: 'call', callee, argument };
}

/** The value on one line, however long that is. */
export function inlineValue(value: Emitted): string {
  switch (value.kind) {
    case 'source':
      return value.text;

    case 'text':
      return literal(value.value);

    case 'object': {
      if (value.entries.length === 0) return '{}';

      const parts = value.entries.map((entry) =>
        entry.value === undefined
          ? entry.key
          : `${entry.key}: ${inlineValue(entry.value)}`,
      );

      return `{ ${parts.join(', ')} }`;
    }

    case 'list':
      return `[${value.items.map(inlineValue).join(', ')}]`;

    case 'call':
      return `${value.callee}(${inlineValue(value.argument)})`;
  }
}

/**
 * The value, on one line where prettier would keep
 * it there and broken open where it would not.
 *
 * `prefix` is whatever stands to the left of it —
 * a key, a declaration — and `suffix` whatever
 * follows the closing bracket.
 */
export function writeValue(
  writer: SourceWriter,
  prefix: string,
  value: Emitted,
  suffix: string,
): void {
  const one = `${prefix}${inlineValue(value)}${suffix}`;

  if (writer.fits(one) && !alwaysBreaks(value)) {
    writer.line(one);
    return;
  }

  switch (value.kind) {
    case 'source':
      // Nothing to break open. A line this wide is
      // one long name, and the alternative is
      // inventing a temporary the author never
      // wrote.
      writer.line(one);
      return;

    case 'text':
      writeSum(writer, prefix, value.value, suffix, false);
      return;

    case 'object':
      writer.open(`${prefix}{`);
      for (const entry of value.entries) {
        if (entry.value === undefined) writer.line(`${entry.key},`);
        else writeEntry(writer, entry.key, entry.value);
      }
      writer.close(`}${suffix}`);
      return;

    case 'list':
      writer.open(`${prefix}[`);
      for (const item of value.items) writeValue(writer, '', item, ',');
      writer.close(`]${suffix}`);
      return;

    case 'call':
      writeValue(
        writer,
        `${prefix}${value.callee}(`,
        value.argument,
        `)${suffix}`,
      );
      return;
  }
}

/**
 * One entry of an object that has been broken
 * open.
 *
 * Prose too wide for the line its key is on moves
 * to a line of its own under the key, which is
 * what prettier does with every assignment it has
 * to break. Nothing else moves: an expression has
 * no seam to break at, so it stays beside its key
 * however wide it is.
 */
function writeEntry(writer: SourceWriter, key: string, value: Emitted): void {
  if (value.kind === 'text' && !writer.fits(`${key}: ${inlineValue(value)},`)) {
    writer.indented(`${key}:`, () => {
      writeSum(writer, '', value.value, ',', true);
    });
    return;
  }

  writeValue(writer, `${key}: `, value, ',');
}

/**
 * Prose too wide for one line, as the sum of
 * pieces that each fit on one.
 *
 * The two shapes are prettier's, and a file that
 * guessed either of them wrong is rewritten the
 * first time anybody formats it. Where the sum
 * stands on its own — a list's member, a call's
 * argument — the first piece stays where the value
 * started and the rest sit one level in. Where the
 * writer has already broken after a key to make
 * room, every piece sits level at that one indent.
 *
 * A piece with no space to break at is left
 * over-wide on a line of its own. That is the same
 * answer the comment wrapper gives, for the same
 * reason: a link in an email body is one word, and
 * cutting it in half would change what it says.
 */
function writeSum(
  writer: SourceWriter,
  prefix: string,
  value: string,
  suffix: string,
  levelled: boolean,
): void {
  const pieces = splitToWidth(value, (index, quoted) =>
    index === 0 || levelled
      ? writer.fits(`${prefix}${quoted} +`)
      : writer.fits(`  ${quoted} +`),
  );
  // The default covers the empty string, which
  // splits into no pieces at all.
  const [first = value, ...rest] = pieces;

  if (rest.length === 0) {
    writer.line(`${prefix}${literal(first)}${suffix}`);
    return;
  }

  const head = `${prefix}${literal(first)} +`;
  const writeRest = (): void => {
    rest.forEach((piece, index) => {
      const tail = index === rest.length - 1 ? suffix : ' +';

      writer.line(`${literal(piece)}${tail}`);
    });
  };

  if (levelled) {
    writer.line(head);
    writeRest();
    return;
  }

  writer.indented(head, writeRest);
}

/**
 * The text, split after spaces into pieces each of
 * which fits where it is going.
 *
 * Split *after* the space rather than on it, so
 * that concatenating the pieces gives back the
 * text somebody actually wrote, space for space.
 */
function splitToWidth(
  value: string,
  fits: (index: number, quoted: string) => boolean,
): string[] {
  const pieces: string[] = [];
  let current = '';

  for (const word of value.split(/(?<= )/)) {
    const candidate = `${current}${word}`;

    if (current !== '' && !fits(pieces.length, literal(candidate))) {
      pieces.push(current);
      current = word;
      continue;
    }

    current = candidate;
  }

  if (current !== '') pieces.push(current);
  return pieces;
}

/**
 * Prettier breaks a list whose members are all
 * objects carrying more than one key, however short
 * they are, as soon as there are two of them.
 * Measuring the width alone would emit something it
 * immediately rewrites.
 */
function alwaysBreaks(value: Emitted): boolean {
  return (
    value.kind === 'list' &&
    value.items.length > 1 &&
    value.items.every(
      (item) => item.kind === 'object' && item.entries.length > 1,
    )
  );
}

/** One checkpoint, as the call it runs. */
export type StepSpec = {
  /** What stands before the call: `await
   *  DBOS.runStep`, or the same with a `const`. */
  head: string;
  call: Emitted;
  options: readonly string[];
};

/**
 * A step, laid out the way prettier lays it out.
 *
 * Three shapes, and which one is right is decided
 * by width the same way prettier decides it. The
 * options hug the call while the head fits. Past
 * that every argument takes a line, and the arrow
 * keeps its call beside it while the call fits on
 * one. Only when the call itself has to break does
 * the arrow move to a line of its own — an emitter
 * that guessed otherwise would produce a file that
 * stops matching itself on the first format.
 */
export function writeStep(writer: SourceWriter, spec: StepSpec): void {
  const arrow = `async () => ${inlineValue(spec.call)}`;

  if (writer.fits(`${spec.head}(${arrow}, {`)) {
    expandedCall(writer, spec.head, arrow, spec.options);
    return;
  }

  writer.open(`${spec.head}(`);

  if (writer.fits(`${arrow},`)) {
    writer.line(`${arrow},`);
    writer.open('{');
  } else {
    writer.open('async () =>');
    writeValue(writer, '', spec.call, ',');
    writer.next('{');
  }

  for (const option of spec.options) writer.line(option);
  writer.close('},');
  writer.close(');');
}

/** What a run parks on, and what wakes it. */
export type WaitShape = {
  /** The local the answer is bound to. */
  local: string;
  /** What the answer was declared to be. */
  type: string;
  /** The topic a message reaches this node on,
   *  which is the node's own id. */
  topic: string;
  timeoutSeconds: number;
  /** Why the file names that many seconds, in the
   *  words a reader of it needs. */
  why: readonly string[];
  /** The row an arriving message is looked up by. */
  register: StepSpec;
  /** Deleting that row, however the wait ended. */
  clear: StepSpec;
  /** Reminders, where the author asked for them. */
  resend?: { counter: string; max: number; step: StepSpec };
  /** What a run does when nothing ever arrives. */
  onNothing: { kind: 'throw'; problem: string } | { kind: 'return' };
};

export function writeWait(writer: SourceWriter, wait: WaitShape): void {
  writeStep(writer, wait.register);
  writer.blank();

  if (wait.resend === undefined) {
    writeRecv(writer, wait, `const ${wait.local} = `);
  } else {
    writeResendLoop(writer, wait, wait.resend);
  }

  writer.blank();
  writeStep(writer, wait.clear);
  writer.blank();

  if (wait.onNothing.kind === 'return') {
    writer.line(`if (${wait.local} === null) return;`);
    return;
  }

  writer.open(`if (${wait.local} === null) {`);
  writeThrow(writer, wait.onNothing.problem);
  writer.close('}');
}

/**
 * The park itself.
 *
 * `recv` answers a timeout with null and never
 * throws, so what follows it is a check rather than
 * a catch — and the options object rather than the
 * positional number of seconds, which the SDK still
 * accepts and no longer recommends.
 */
function writeRecv(
  writer: SourceWriter,
  wait: WaitShape,
  assign: string,
): void {
  writer.comment(
    'recv answers a timeout with null and never throws, so this is a ' +
      'check and not a catch.',
  );
  for (const line of wait.why) writer.comment(line);

  expandedCall(
    writer,
    `${assign}await DBOS.recv<${wait.type}>`,
    `'${wait.topic}'`,
    [`timeoutSeconds: ${wait.timeoutSeconds},`],
  );
}

/**
 * A park that sends a reminder and parks again, up
 * to the number of reminders the author asked for.
 *
 * The counter moves before the reminder goes out
 * because it is part of the step's recorded name:
 * two reminders that recorded one name would fail
 * every recovery after the second.
 */
function writeResendLoop(
  writer: SourceWriter,
  wait: WaitShape,
  resend: NonNullable<WaitShape['resend']>,
): void {
  writer.line(`let ${resend.counter} = 0;`);
  writer.line(`let ${wait.local}: ${wait.type} | null = null;`);
  writer.open('for (;;) {');
  writeRecv(writer, wait, `${wait.local} = `);
  writer.line(`if (${wait.local} !== null) break;`);
  writer.line(`if (${resend.counter} >= ${resend.max}) break;`);
  writer.line(`${resend.counter} += 1;`);
  writer.blank();
  writeStep(writer, resend.step);
  writer.close('}');
}

/**
 * A wait on the clock alone.
 *
 * No topic, no timeout, no reminder and no row: a
 * timer has no sender, so there is nobody to
 * correlate with and nothing to remind.
 */
export function writeTimer(writer: SourceWriter, seconds: number): void {
  writer.comment(
    'Durable: the wake-up time is written to the database, so the wait ' +
      'survives a restart.',
  );
  writer.comment(`${seconds} seconds, as milliseconds.`);
  writer.line(`await DBOS.sleep(${seconds * 1000});`);
}
