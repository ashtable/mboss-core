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
 */
export function readLibSources(libDir: string): LibSourceFile[] {
  const projectDir = dirname(libDir);

  return readdirSync(libDir, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => ({
      path: toPosix(relative(projectDir, join(libDir, entry))),
      content: readFileSync(join(libDir, entry), 'utf8'),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
