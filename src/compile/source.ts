/**
 * The buffer every emitter writes through.
 *
 * It knows about three things and nothing else:
 * the current indent, how a comment wraps, and
 * that two blank lines in a row are one blank
 * line. Everything about *what* generated code
 * says lives in the emitters; this is only how it
 * reaches the page.
 */

/** Two spaces, the way the rest of the house. */
const INDENT_STEP = 2;

/**
 * The widest a wrapped comment line may be,
 * counted from column zero — the indent and the
 * `// ` included.
 */
const COMMENT_COLUMNS = 50;

/** The width prettier is asked to format to. */
const CODE_COLUMNS = 80;

export class SourceWriter {
  #lines: string[] = [];
  #indent: number;

  /**
   * `indent` is where the buffer starts, for a
   * fragment that will be pasted inside something
   * else. It matters because `fits` is what
   * chooses a call's layout, and a fragment
   * indented after the fact would have measured
   * every line two columns short.
   */
  constructor(indent = 0) {
    this.#indent = indent;
  }

  /** One line at the current indent. */
  line(text?: string): void {
    if (text === undefined || text === '') {
      this.#push('');
      return;
    }

    this.#push(`${' '.repeat(this.#indent)}${text}`);
  }

  /** A line, then everything after it one deeper. */
  open(text: string): void {
    this.line(text);
    this.#indent += INDENT_STEP;
  }

  /**
   * Back out one level, then the closing line.
   *
   * A blank line immediately above the close goes
   * with it: prettier deletes one, so a writer
   * that left it there would be producing output
   * that is not already formatted.
   */
  close(text: string): void {
    if (this.#lines.at(-1) === '') this.#lines.pop();

    this.#indent = Math.max(0, this.#indent - INDENT_STEP);
    this.line(text);
  }

  /**
   * The line between two blocks: back out one
   * level, write it, and go one deeper again.
   *
   * `} else {` is one line as far as prettier is
   * concerned, so a close followed by an open
   * would emit source prettier immediately
   * rewrites.
   */
  next(text: string): void {
    this.close(text);
    this.#indent += INDENT_STEP;
  }

  /**
   * A `//` comment, hard-wrapped so no line of it
   * passes fifty columns.
   *
   * A single word wider than the budget is left
   * alone on its own line. Some things do not
   * wrap: a path, a URL, the document a generated
   * file names in its own header.
   */
  comment(prose: string): void {
    const budget = COMMENT_COLUMNS - this.#indent - '// '.length;

    for (const words of wrap(prose.split(/\s+/).filter(Boolean), budget)) {
      this.line(`// ${words}`);
    }
  }

  /** One blank line, however many are asked for. */
  blank(): void {
    this.#push('');
  }

  /**
   * Whether a line of this text would fit inside
   * the code width at the current indent.
   *
   * Emitters ask because prettier asks: a call
   * whose head fits keeps its options hugged onto
   * it, and one whose head does not gets every
   * argument on a line of its own. Choosing the
   * same way prettier would is what makes emitted
   * source already formatted.
   */
  fits(text: string): boolean {
    return this.#indent + [...text].length <= CODE_COLUMNS;
  }

  /** The buffer, ending in one newline. */
  toString(): string {
    const lines = [...this.#lines];
    while (lines.at(-1) === '') lines.pop();

    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  /**
   * Blanks collapse here rather than at each call
   * site: an emitter that separates its sections
   * with a blank line should not have to know
   * whether the section before it ended with one.
   */
  #push(text: string): void {
    if (
      text === '' &&
      (this.#lines.length === 0 || this.#lines.at(-1) === '')
    ) {
      return;
    }

    this.#lines.push(text);
  }
}

/**
 * Greedy line breaking: as many words as fit, then
 * the next line.
 */
function wrap(words: readonly string[], budget: number): string[] {
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;

    if (current !== '' && [...candidate].length > budget) {
      lines.push(current);
      current = word;
      continue;
    }

    current = candidate;
  }

  if (current !== '') lines.push(current);
  return lines;
}
