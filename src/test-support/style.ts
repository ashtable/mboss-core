import { basename, extname } from 'node:path';

/**
 * The house style rules, as auditors that run over
 * generated text.
 *
 * The compiler and the scaffold write files nobody
 * reviews line by line, so the rules this repo
 * follows by hand have to be checked by a program
 * on the way out. These functions are that check.
 * They audit *emitted* output — this repo's own
 * sources are covered by eslint and prettier.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */

/**
 * One offending line. `citationProblems` and
 * `controlProblems` report the same shape: a
 * reader wants the line, the text and the reason
 * whichever rule was broken.
 */
export type WidthProblem = { line: number; text: string; why: string };

const MAX_CODE_COLUMNS = 80;
const MAX_COMMENT_COLUMNS = 50;

/**
 * How a whole-line comment opens, by file. A
 * checker that knew only `//` would pass a
 * 79-column comment in the compose file, the
 * Dockerfile and the entrypoint while claiming the
 * rule was enforced — and the scaffold emits more
 * `#`-commented files than TypeScript ones.
 *
 * `null` means the file has no comment syntax to
 * scope to. Those are width- and citation-checked
 * over the whole line instead.
 */
type Marker = '//' | '#' | '--' | null;

const MARKER_BY_NAME: Record<string, Marker> = {
  Dockerfile: '#',
  '.gitignore': '#',
  '.dockerignore': '#',
  '.prettierignore': '#',
  'migration_lock.toml': '#',
};

const MARKER_BY_EXTENSION: Record<string, Marker> = {
  '.ts': '//',
  '.mjs': '//',
  '.prisma': '//',
  '.yml': '#',
  '.yaml': '#',
  '.sh': '#',
  '.toml': '#',
  '.sql': '--',
  '.json': null,
  '.md': null,
  '.txt': null,
};

/**
 * The comment marker for a path, or `null` for a
 * file with no comment syntax.
 *
 * An unrecognised file also gets `null` rather
 * than an error: the 80-column rule still applies
 * to it, and only the comment rule is skipped,
 * which is the right answer for the extensionless
 * files the scaffold emits.
 */
function markerFor(path: string): Marker {
  const name = basename(path);

  if (name in MARKER_BY_NAME) return MARKER_BY_NAME[name] ?? null;
  // `.env`, `.env.example`, `.env.local`: one
  // family, one rule.
  if (name === '.env' || name.startsWith('.env.')) return '#';

  const extension = extname(name);
  if (extension in MARKER_BY_EXTENSION) {
    return MARKER_BY_EXTENSION[extension] ?? null;
  }
  return null;
}

/**
 * A `//` file's comments do not all start with
 * `//`: most of the prose in this house lives in
 * jsdoc blocks, whose lines open with `*`. Longest
 * opener first, so `/**` is not read as `/*`.
 */
const TS_OPENERS = ['/**', '*/', '//', '/*', '*'];

/**
 * The prose of a whole-line comment, with the
 * marker and one following space removed, or
 * `null` when the line is not a whole-line
 * comment.
 *
 * Only whole-line comments are considered. A
 * trailing comment after code is checked for width
 * as part of its line, and looking inside code for
 * a comment marker would find the `//` in a URL
 * string.
 */
function commentContent(line: string, marker: Marker): string | null {
  if (marker === null) return null;

  const trimmed = line.trimStart();
  const openers = marker === '//' ? TS_OPENERS : [marker];

  for (const opener of openers) {
    if (!trimmed.startsWith(opener)) continue;
    const rest = trimmed.slice(opener.length);
    return (rest.startsWith(' ') ? rest.slice(1) : rest).trimEnd();
  }
  return null;
}

/** Columns, not bytes: an em-dash is one column. */
function columns(text: string): number {
  return [...text].length;
}

/**
 * Lines that break the width rule: over 80 columns
 * for any line, over 50 for a whole-line comment.
 *
 * The comment limit is measured on the comment's
 * own prose rather than on the physical line,
 * which is what this house actually does — nesting
 * a comment inside a function body would otherwise
 * make the same sentence legal at the top level
 * and illegal one indent in.
 *
 * A comment whose prose holds no space at all is
 * left alone. Some things do not wrap: a path, a
 * URL, the workflow document a generated file
 * names in its own header.
 */
export function widthProblems(source: string, path: string): WidthProblem[] {
  const marker = markerFor(path);
  const found: WidthProblem[] = [];

  source.split('\n').forEach((text, index) => {
    const width = columns(text);
    if (width > MAX_CODE_COLUMNS) {
      found.push({
        line: index + 1,
        text,
        why: `line is ${width} columns; the limit is ${MAX_CODE_COLUMNS}`,
      });
      return;
    }

    const content = commentContent(text, marker);
    if (content === null || !content.includes(' ')) return;

    const commentWidth = columns(content);
    if (commentWidth > MAX_COMMENT_COLUMNS) {
      found.push({
        line: index + 1,
        text,
        why:
          `comment is ${commentWidth} columns; the limit is ` +
          `${MAX_COMMENT_COLUMNS}`,
      });
    }
  });

  return found;
}

/**
 * A mockup id: a digit and one or two letters,
 * standing alone. Narrow, and deliberately not
 * free of false positives — `2xx` and `1st` match
 * too. The escape hatch is to reword, never to
 * suppress, because a comment that has to say
 * `2xx` can say "a success status" instead and
 * read better for it.
 */
const MOCKUP_ID = /(?<![\w$])[1-9][a-z]{1,2}(?![\w$])/;

const DECISION_MARKER = /\[D\d{2}\]/;

/**
 * Lines that cite something a reader of the code
 * cannot open: a design-doc section, a decision
 * marker, a mockup id.
 *
 * Checked over comments only, so a string literal
 * holding `4k` is left alone. A file with no
 * comment syntax is checked whole — it is prose a
 * reader sees either way.
 */
export function citationProblems(source: string, path: string): WidthProblem[] {
  const marker = markerFor(path);
  const found: WidthProblem[] = [];

  source.split('\n').forEach((text, index) => {
    const prose = marker === null ? text : commentContent(text, marker);
    if (prose === null) return;

    const reasons: string[] = [];
    if (prose.includes('§')) reasons.push('cites §');
    if (DECISION_MARKER.test(prose)) reasons.push('names a decision marker');

    const mockup = MOCKUP_ID.exec(prose);
    if (mockup) reasons.push(`names the mockup id ${mockup[0]}`);

    if (reasons.length > 0) {
      found.push({ line: index + 1, text, why: reasons.join('; ') });
    }
  });

  return found;
}

/**
 * Lines holding a control character — anything
 * below U+0020 that is not a tab, and that
 * includes a carriage return.
 *
 * Nothing else in the chain sees these. A stray
 * NUL makes git classify a source file as binary
 * and makes grep skip it, while prettier, eslint
 * and tsc all accept it without a word.
 */
export function controlProblems(source: string): WidthProblem[] {
  const found: WidthProblem[] = [];

  source.split('\n').forEach((text, index) => {
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      if (code >= 0x20 || character === '\t') continue;

      const hex = code.toString(16).toUpperCase().padStart(4, '0');
      found.push({
        line: index + 1,
        text,
        why: `control character U+${hex}`,
      });
      return;
    }
  });

  return found;
}

/**
 * Every rule at once, for the tests that assert a
 * generated file is house-clean. Throws with the
 * whole list, because fixing them one run at a
 * time is nobody's idea of a good afternoon.
 */
export function expectHouseStyle(source: string, path: string): void {
  const problems = [
    ...widthProblems(source, path),
    ...citationProblems(source, path),
    ...controlProblems(source),
  ].sort((a, b) => a.line - b.line);

  if (problems.length === 0) return;

  const lines = problems.map((p) => `  line ${p.line}: ${p.why}`);
  throw new Error(`${path} breaks the house style:\n${lines.join('\n')}`);
}
