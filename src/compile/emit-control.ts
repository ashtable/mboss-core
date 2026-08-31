import { literal } from './predicate.js';
import type { SourceWriter } from './source.js';

/**
 * How the shapes that take more than one line
 * reach the page.
 *
 * Nothing here knows what a workflow is. It is
 * handed conditions as text and arms as closures,
 * and its whole job is the layout — which arm
 * chains onto which, where the counter is declared,
 * what follows a loop that ran out of rounds, and
 * whether a call keeps its options hugged onto it.
 * Keeping it separate is what lets the shapes be
 * tested without a graph, and it is also the only
 * way the emitter stays readable: deciding where a
 * run goes and writing braces are two different
 * jobs.
 */

/** One outcome of a branch, as it is written. */
export type BranchArm = {
  /** The condition, or absent for the way out a
   *  run takes when nothing else matched. */
  condition?: string;
  /**
   * Writes the arm's statements, and answers
   * whether control leaves the branch — a `break`,
   * a `continue` or a `return`.
   */
  body: () => boolean;
};

/**
 * A value produced inside a loop and read after
 * it.
 *
 * It cannot stay a loop-local `const`: the reader
 * is outside the block. It cannot be declared
 * assigned either, because TypeScript will not
 * accept a definite-assignment claim for something
 * only assigned inside a loop body. So it is a
 * `let` that admits `undefined`, and the check
 * below says in code what the graph already says.
 */
export type CarriedValue = {
  /** The `let` the loop copies the value into. */
  name: string;
  /** What the block that produced it declared. */
  type: string;
  /** Which block produced it, for the message. */
  nodeId: string;
};

/** What happens when a loop runs out of rounds. */
export type Exhaustion =
  { kind: 'abort'; rounds: number; problem: string } | { kind: 'continue' };

/**
 * The cases in the order the author wrote them,
 * first match wins.
 *
 * An arm that leaves lets the next case stand on
 * its own rather than chain onto it: nothing after
 * such an arm can run when it was taken, so the
 * `else` would say nothing and cost a level of
 * indentation. Once an arm falls through, though,
 * every case after it has to stay inside the
 * chain — a fresh `if` there would run a second
 * arm after the first had already run.
 */
export function writeBranch(
  writer: SourceWriter,
  arms: readonly BranchArm[],
): void {
  let chained = false;

  for (const arm of arms) {
    if (arm.condition === undefined) {
      if (!chained) {
        arm.body();
        return;
      }

      writer.next('} else {');
      arm.body();
      writer.close('}');
      return;
    }

    if (chained) writer.next(`} else if (${arm.condition}) {`);
    else writer.open(`if (${arm.condition}) {`);

    const leaves = arm.body();

    if (leaves && !chained) {
      writer.close('}');
      writer.blank();
    } else chained = true;
  }

  if (chained) writer.close('}');
}

/**
 * A loop drawn as a branch that wires back to an
 * earlier block.
 *
 * The counter is the loop's own, and every step
 * inside records its round in its name — DBOS
 * compares that name on replay, so two rounds of
 * one block have to be two different names.
 *
 * `resume` is what tells the two ways out apart.
 * A run that left by an exit set it; a run that
 * fell out of the bottom did not, and that is the
 * case the author asked to abort or to carry on
 * from.
 */
export function writeBackEdgeLoop(
  writer: SourceWriter,
  opts: {
    round: string;
    resume: string;
    carried: readonly CarriedValue[];
    workflow: string;
    unreachable: string;
    exhaustion: Exhaustion;
    body: () => void;
  },
): void {
  writer.line(`let ${opts.round} = 0;`);
  writer.line(`let ${opts.resume} = false;`);
  writeCarried(writer, opts.carried);
  writer.blank();

  writer.open('do {');
  writer.line(`${opts.round} += 1;`);
  writer.blank();
  opts.body();

  // A bound the author asked to abort on is the
  // loop's own condition. One they asked to carry
  // on from is folded into the case instead, so
  // that the last round falls through to whatever
  // the branch says comes next.
  writer.close(
    opts.exhaustion.kind === 'abort'
      ? `} while (${opts.round} < ${opts.exhaustion.rounds});`
      : `} while (!${opts.resume});`,
  );
  writer.blank();

  if (opts.exhaustion.kind === 'abort') {
    writer.open(`if (!${opts.resume}) {`);
    writeThrow(writer, opts.exhaustion.problem);
    writer.close('}');
  } else {
    // Reached only when every way out of the
    // branch ended the run.
    writer.line(`if (!${opts.resume}) return;`);
  }

  writer.blank();
  writeCarriedChecks(writer, opts);
}

/**
 * The `loop` block: a fixed number of rounds over
 * a contiguous run of blocks.
 *
 * The catalog carries a floor as well as a
 * ceiling, and the floor has no compiled effect —
 * there is no exit signal anywhere in a workflow
 * document, so "between two and four rounds with
 * nothing to stop it" can only honestly be four.
 */
export function writeCountedLoop(
  writer: SourceWriter,
  opts: {
    round: string;
    rounds: number;
    carried: readonly CarriedValue[];
    workflow: string;
    unreachable: string;
    body: () => void;
  },
): void {
  writeCarried(writer, opts.carried);
  if (opts.carried.length > 0) writer.blank();

  const counter = opts.round;

  writer.open(
    `for (let ${counter} = 1; ${counter} <= ${opts.rounds}; ` +
      `${counter} += 1) {`,
  );
  opts.body();
  writer.close('}');
  writer.blank();

  writeCarriedChecks(writer, opts);
}

function writeCarried(
  writer: SourceWriter,
  carried: readonly CarriedValue[],
): void {
  for (const value of carried) {
    writer.line(`let ${value.name}: ${value.type} | undefined;`);
  }
}

/**
 * One check per value the loop carried out, before
 * the first block that reads one.
 *
 * The check is here because the type says so. A
 * cast would be a claim about which of the two is
 * authoritative, and the type is.
 */
function writeCarriedChecks(
  writer: SourceWriter,
  opts: {
    carried: readonly CarriedValue[];
    workflow: string;
    unreachable: string;
  },
): void {
  for (const value of opts.carried) {
    writer.open(`if (${value.name} === undefined) {`);
    writer.comment(opts.unreachable);
    writeThrow(writer, `${opts.workflow}: ${value.nodeId} produced no result.`);
    writer.close('}');
    writer.blank();
  }
}

/**
 * A call whose last argument is an options object,
 * laid out the way prettier lays it out: hugged
 * onto the call when the head fits, and with every
 * argument on a line of its own when it does not.
 *
 * A free function over a writer rather than a
 * method, because the callers write into different
 * buffers and all of them have calls too wide for
 * one line.
 */
export function expandedCall(
  writer: SourceWriter,
  head: string,
  argument: string,
  options: readonly string[],
  terminator = ';',
): void {
  const hug = `${head}(${argument}, {`;

  if (writer.fits(hug)) {
    writer.open(hug);
    for (const option of options) writer.line(option);
    writer.close(`})${terminator}`);
    return;
  }

  writer.open(`${head}(`);
  writer.line(`${argument},`);
  writer.open('{');
  for (const option of options) writer.line(option);
  writer.close('},');
  writer.close(`)${terminator}`);
}

/**
 * A throw, hugged onto one line where it fits and
 * broken the way prettier breaks it where it does
 * not.
 */
export function writeThrow(writer: SourceWriter, problem: string): void {
  const one = `throw new Error(${literal(problem)});`;

  if (writer.fits(one)) {
    writer.line(one);
    return;
  }

  writer.open('throw new Error(');
  writer.line(`${literal(problem)},`);
  writer.close(');');
}
