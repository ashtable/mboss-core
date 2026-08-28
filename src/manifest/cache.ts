import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readLibSources, sourceHashOf } from './hash.js';
import { scanLib } from './scan.js';
import { LibManifestSchema, type LibManifest } from './types.js';

/**
 * Where the derived manifest is kept. It is
 * gitignored in a scaffolded project: it is a
 * cache of the code beside it, never a source of
 * truth.
 */
const CACHE_PATH = join('.mboss', 'manifest.json');

/**
 * Returns the project's manifest, scanning its
 * code-behind only when that code has changed.
 *
 * The sources are hashed before the cache is
 * consulted, so a cache written by an older build
 * — or edited by hand — is rejected on content
 * rather than on a timestamp that a checkout or a
 * file copy can make meaningless.
 *
 * `scan` is injectable so a caller can prove the
 * rescan did not happen, rather than infer it.
 */
export function loadOrScan(
  projectDir: string,
  opts?: { scan?: typeof scanLib },
): LibManifest {
  const libDir = join(projectDir, 'lib');
  const sources = readLibSources(libDir);
  const sourceHash = sourceHashOf(sources);
  const cachePath = join(projectDir, CACHE_PATH);

  const cached = readCache(cachePath);
  if (cached?.sourceHash === sourceHash) return cached;

  const manifest = (opts?.scan ?? scanLib)(libDir);

  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return manifest;
}

/**
 * The cache is a file on disk that nothing
 * guarantees: absent, half-written, or left behind
 * by a version that wrote a different shape. Every
 * one of those means "scan", not "fail".
 */
function readCache(cachePath: string): LibManifest | undefined {
  let text: string;
  try {
    text = readFileSync(cachePath, 'utf8');
  } catch {
    return undefined;
  }

  try {
    return LibManifestSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}
