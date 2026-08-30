import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * The files a `/lib` scan reads, and the digest
 * that decides whether a cached manifest may be
 * reused.
 */

/**
 * One file a scan read. `path` is relative to the
 * project root and always posix-separated, so a
 * hash computed on Windows matches one computed in
 * CI.
 */
export interface LibSourceFile {
  path: string;
  content: string;
}

/**
 * A single digest over a set of code-behind files.
 *
 * The path is hashed alongside the content, so
 * renaming a file without editing it still
 * invalidates the cache — the manifest records
 * where each export lives, and the compiler emits
 * import paths from it.
 *
 * Files are digested individually and combined in
 * path order, so the caller may list them in any
 * order it likes.
 */
export function sourceHashOf(files: readonly LibSourceFile[]): string {
  const perFile = files
    .map((file) => ({
      path: file.path,
      // Two fixed-length digests concatenated. A
      // separator character between path and
      // content would have to be one that neither
      // can contain, and there isn't one.
      digest: sha256(sha256(file.path) + sha256(file.content)),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return sha256(perFile.map((file) => file.digest).join(''));
}

/**
 * Reads the code-behind files a scan is allowed to
 * see: TypeScript sources under `libDir`, minus
 * test files.
 *
 * The scanner and the cache key both come from
 * this one list. If the hash covered files the
 * scan ignores, editing a test would force a
 * pointless rescan; if it covered fewer, an edit
 * the scan does see could go unnoticed.
 *
 * A project with no `lib/` reads the same as one
 * with an empty `lib/`: git does not track an
 * empty directory, so a draft whose handlers do
 * not exist yet arrives at a clone with nothing
 * there, and that is a project to draw rather than
 * a reason to stop.
 */
export function readLibSources(libDir: string): LibSourceFile[] {
  const projectDir = dirname(libDir);

  return entriesOf(libDir)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => ({
      path: toPosix(relative(projectDir, join(libDir, entry))),
      content: readFileSync(join(libDir, entry), 'utf8'),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Everything under `libDir`, or nothing at all
 * when there is no such directory. Any other
 * failure — a permission, a broken disk — is left
 * to throw, because it means something the caller
 * cannot draw around.
 */
function entriesOf(libDir: string): string[] {
  try {
    return readdirSync(libDir, { recursive: true }).map(String);
  } catch (error) {
    if (isMissing(error)) return [];

    throw error;
  }
}

/**
 * Node reports a missing directory as an ENOENT on
 * an error a `catch` hands over as `unknown`.
 */
function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/**
 * The one place a filesystem path becomes a
 * manifest path, so nothing downstream has to know
 * which separator the scan ran on.
 */
export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
