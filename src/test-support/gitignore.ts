/**
 * Enough of git's ignore rules to answer one
 * question about an emitted `.gitignore`: is this
 * path committed or not?
 *
 * A string comparison against the whole file would
 * only prove the file did not change, not that it
 * means what it should — and in a generated
 * project that file is also the deploy manifest,
 * because `railway up` honours it. So the test
 * asks about paths rather than about text.
 *
 * This knows the subset the scaffold emits:
 * comments, blank lines, a trailing slash for a
 * directory, a leading or interior slash for an
 * anchored pattern, and `*` and `?` within one
 * segment. It refuses a negation outright rather
 * than guessing, so a file that grows one fails
 * here instead of quietly reporting the wrong
 * answer.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */

export type IgnorePattern = {
  /** The line as written, for a failure message. */
  source: string;
  /** Matched against the whole path from the root
   *  rather than against any single segment. */
  anchored: boolean;
  /** Written with a trailing slash: it matches a
   *  directory and everything under it, never a
   *  file of the same name. */
  dirOnly: boolean;
  /** One matcher per segment of the pattern. */
  segments: RegExp[];
};

/**
 * One path segment's glob, as a regular
 * expression. `*` and `?` stop at a separator,
 * which they cannot reach here anyway — the
 * pattern was already split on `/`.
 */
function segmentPattern(glob: string): RegExp {
  const body = [...glob]
    .map((character) => {
      if (character === '*') return '[^/]*';
      if (character === '?') return '[^/]';
      return character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');

  return new RegExp(`^${body}$`);
}

export function parseIgnoreFile(text: string): IgnorePattern[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      if (line.startsWith('!')) {
        throw new Error(`negation is not supported: ${line}`);
      }

      const dirOnly = line.endsWith('/');
      const body = dirOnly ? line.slice(0, -1) : line;
      const anchored = body.includes('/');

      return {
        source: line,
        anchored,
        dirOnly,
        segments: body
          .split('/')
          .filter((part) => part.length > 0)
          .map(segmentPattern),
      };
    });
}

/**
 * Whether git would ignore `path`.
 *
 * A trailing slash on `path` says it names a
 * directory. Without one it is a file, which is
 * the difference between `build/` matching and not
 * matching.
 *
 * Ignoring a directory ignores everything under
 * it, so every prefix of the path is offered to
 * every pattern rather than only the whole thing.
 */
export function isIgnored(
  patterns: readonly IgnorePattern[],
  path: string,
): boolean {
  const isDirectory = path.endsWith('/');
  const segments = path.split('/').filter((part) => part.length > 0);

  return segments.some((_segment, index) => {
    // Every component but the last one names a
    // directory, whatever the path as a whole
    // names.
    const prefixIsDirectory = index < segments.length - 1 || isDirectory;

    return patterns.some((pattern) => {
      if (pattern.dirOnly && !prefixIsDirectory) return false;

      const candidate = segments.slice(0, index + 1);
      if (!pattern.anchored) {
        const last = candidate[index];

        return last !== undefined && pattern.segments[0]?.test(last) === true;
      }

      // A pattern with more segments than the
      // path cannot match it, and without this
      // guard a trailing `*` would happily match
      // the segment that is not there.
      if (pattern.segments.length > candidate.length) return false;

      return pattern.segments.every(
        (matcher, at) => matcher.test(candidate[at] ?? '') === true,
      );
    });
  });
}
