import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseKeyRing } from '../signed-links/index.js';
import {
  makeTypecheckProject,
  removeTypecheckProject,
  type TypecheckProject,
} from '../test-support/typecheck.js';

import { SCAFFOLD_DIRS, scaffoldFiles } from './files.js';
import { scaffoldProject } from './scaffold.js';
import {
  PLACEHOLDER_EVENTS_SECRET,
  PLACEHOLDER_LINK_KEYS,
} from './templates/env.js';

/**
 * The half that touches the disk.
 *
 * It starts from a bare directory — not one that
 * already has `.mboss/` in it — because creating
 * that directory is part of what is being tested,
 * and because a pre-created one would trip the
 * refusal that keeps a second scaffold from
 * rewriting somebody's `.env`.
 */

let project: TypecheckProject;

beforeEach(async () => {
  project = await makeTypecheckProject();
});

afterEach(async () => {
  await removeTypecheckProject(project);
});

describe('scaffoldProject', () => {
  it('writes every file and creates every empty directory', async () => {
    await scaffoldProject(project.projectDir, { name: 'my_app' });

    expect(existsSync(project.mbossDir)).toBe(true);
    for (const dir of SCAFFOLD_DIRS) {
      expect(statSync(join(project.projectDir, dir)).isDirectory()).toBe(true);
    }

    const written = scaffoldFiles({ name: 'my_app' }).map((file) => file.path);

    expect(written.length).toBeGreaterThan(20);
    for (const path of written) {
      expect(existsSync(join(project.projectDir, path))).toBe(true);
    }
  });

  it('writes nothing the file set did not name', async () => {
    await scaffoldProject(project.projectDir, { name: 'my_app' });

    const expected = scaffoldFiles({ name: 'my_app' })
      .map((file) => file.path)
      .sort();

    expect(filesUnder(project.projectDir).sort()).toEqual(expected);
    expect(emptyDirectoriesUnder(project.projectDir).sort()).toEqual(
      [...SCAFFOLD_DIRS].sort(),
    );
  });

  it('writes the bytes the deterministic half produced', async () => {
    const linkKeys = `k1:${'ab'.repeat(32)}`;
    await scaffoldProject(project.projectDir, {
      name: 'my_app',
      linkKeys,
      eventsSecret: 'test-events-secret',
    });

    for (const file of scaffoldFiles({
      name: 'my_app',
      linkKeys,
      eventsSecret: 'test-events-secret',
    })) {
      const onDisk = readFileSync(join(project.projectDir, file.path), 'utf8');

      expect(onDisk).toBe(file.contents);
    }
  });

  it('makes the entrypoint executable', async () => {
    // A container that starts with a bare
    // "permission denied" and no other output is a
    // bad first ten minutes.
    await scaffoldProject(project.projectDir, { name: 'my_app' });

    const path = join(project.projectDir, 'docker-entrypoint.sh');

    expect(statSync(path).mode & 0o777).toBe(0o755);
  });

  it('writes the secrets file so only its owner can read it', async () => {
    // `.env` carries the freshly minted signing
    // ring and the events secret. At the default
    // 0644 every other account on a build host, a
    // CI runner or a shared machine can read both,
    // and the scaffolder already has the mechanism
    // it needs — it just was not using it here.
    await scaffoldProject(project.projectDir, { name: 'my_app' });

    const path = join(project.projectDir, '.env');

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('mints a key ring and an events secret when none were given', async () => {
    await scaffoldProject(project.projectDir, { name: 'my_app' });
    const env = readFileSync(join(project.projectDir, '.env'), 'utf8');
    const ring = /^LINK_KEYS="(.+)"$/m.exec(env)?.[1] ?? '';
    const secret = /^EVENTS_SECRET="(.+)"$/m.exec(env)?.[1] ?? '';

    expect(parseKeyRing(ring).active.kid).toBe('k1');
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(ring).not.toContain(PLACEHOLDER_LINK_KEYS);
    expect(secret).not.toBe(PLACEHOLDER_EVENTS_SECRET);

    const second = await makeTypecheckProject();
    try {
      await scaffoldProject(second.projectDir, { name: 'my_app' });
      const other = readFileSync(join(second.projectDir, '.env'), 'utf8');
      const otherRing = /^LINK_KEYS="(.+)"$/m.exec(other)?.[1] ?? '';
      const otherSecret = /^EVENTS_SECRET="(.+)"$/m.exec(other)?.[1] ?? '';

      expect(otherRing).not.toBe(ring);
      expect(otherSecret).not.toBe(secret);
    } finally {
      await removeTypecheckProject(second);
    }
  });

  it('keeps a supplied secret rather than minting over it', async () => {
    const linkKeys = `k1:${'cd'.repeat(32)}`;
    await scaffoldProject(project.projectDir, { name: 'my_app', linkKeys });
    const env = readFileSync(join(project.projectDir, '.env'), 'utf8');

    expect(env).toContain(linkKeys);
  });
});

describe('a directory that is already a project', () => {
  it('is refused when it holds .mboss/, and is left alone', async () => {
    // A second scaffold would mint a new key ring
    // into .env, and every form link already sent
    // would stop verifying.
    await mkdir(project.mbossDir, { recursive: true });

    await expect(
      scaffoldProject(project.projectDir, { name: 'my_app' }),
    ).rejects.toThrow(/already/);

    expect(readdirSync(project.projectDir)).toEqual(['.mboss']);
  });

  it('is refused when it holds package.json, and is left alone', async () => {
    const path = join(project.projectDir, 'package.json');
    await writeFile(path, '{ "name": "someone-elses" }\n', 'utf8');

    await expect(
      scaffoldProject(project.projectDir, { name: 'my_app' }),
    ).rejects.toThrow(/already/);

    expect(readdirSync(project.projectDir)).toEqual(['package.json']);
    expect(readFileSync(path, 'utf8')).toBe('{ "name": "someone-elses" }\n');
  });

  it('is refused before a name it could not use is even parsed', async () => {
    await expect(
      scaffoldProject(project.projectDir, { name: 'Not A Name' }),
    ).rejects.toThrow();

    expect(readdirSync(project.projectDir)).toEqual([]);
  });
});

/** Every file on disk, project-relative, posix. */
function filesUnder(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix)).flatMap((name) => {
    const relative = prefix === '' ? name : `${prefix}/${name}`;

    return statSync(join(root, relative)).isDirectory()
      ? filesUnder(root, relative)
      : [relative];
  });
}

/** And every directory that holds no file at all,
 *  which is the other half of the tree. */
function emptyDirectoriesUnder(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix)).flatMap((name) => {
    const relative = prefix === '' ? name : `${prefix}/${name}`;
    if (!statSync(join(root, relative)).isDirectory()) return [];

    const below = emptyDirectoriesUnder(root, relative);

    return filesUnder(root, relative).length === 0 && below.length === 0
      ? [relative]
      : below;
  });
}
