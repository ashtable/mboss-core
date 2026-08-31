import { existsSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { writeFileAtomic } from '../apply/atomic-write.js';
import { mbossDirOf } from '../apply/paths.js';

import { SCAFFOLD_DIRS, scaffoldFiles, type ScaffoldOptions } from './files.js';
import { mintEventsSecret, mintLinkKeys } from './secrets.js';

/**
 * Creating a project on disk.
 *
 * The half that is not a pure function: it mints
 * the two secrets and it writes. Everything about
 * *what* is written lives in `scaffoldFiles`,
 * which is deterministic and pinned; this decides
 * only where the bytes go and refuses to put them
 * somewhere they would destroy something.
 */

/**
 * Whether this directory is already somebody's
 * project.
 *
 * Either mark is enough to refuse. Scaffolding
 * over an existing project would mint a fresh key
 * ring into `.env`, and every form link already in
 * somebody's inbox would stop verifying — and it
 * would overwrite a runtime the owner has been
 * editing since the day it was written. Neither
 * has an undo.
 */
function occupiedBy(dir: string): string | undefined {
  if (existsSync(mbossDirOf(dir))) return '.mboss/';
  if (existsSync(join(dir, 'package.json'))) return 'package.json';

  return undefined;
}

/**
 * Writes a new project into `dir`.
 *
 * The whole file set is built before the first
 * directory is created, so a name the scaffold
 * cannot use — or any other refusal — leaves the
 * directory exactly as it was found.
 */
export async function scaffoldProject(
  dir: string,
  options: ScaffoldOptions,
): Promise<void> {
  const occupied = occupiedBy(dir);
  if (occupied !== undefined) {
    throw new Error(
      `${dir} already holds ${occupied}; refusing to scaffold over it`,
    );
  }

  const files = scaffoldFiles({
    ...options,
    linkKeys: options.linkKeys ?? mintLinkKeys(),
    eventsSecret: options.eventsSecret ?? mintEventsSecret(),
  });

  for (const relative of SCAFFOLD_DIRS) {
    await mkdir(join(dir, relative), { recursive: true });
  }

  for (const file of files) {
    const path = join(dir, file.path);

    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, file.contents);
    if (file.mode !== undefined) await chmod(path, file.mode);
  }
}
