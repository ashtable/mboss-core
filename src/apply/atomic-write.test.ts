import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeFileAtomic } from './atomic-write.js';

describe('writeFileAtomic', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mboss-'));
    path = join(dir, 'doc.json');
    await writeFile(path, 'old', 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('never leaves the destination holding half a write', async () => {
    const seen = { destination: '', temp: '', tempDir: '', entries: 0 };

    await writeFileAtomic(path, 'new', {
      beforeRename: async (tempPath) => {
        seen.destination = await readFile(path, 'utf8');
        seen.temp = await readFile(tempPath, 'utf8');
        seen.tempDir = dirname(tempPath);
        seen.entries = (await readdir(dir)).length;
      },
    });

    expect(seen.destination).toBe('old');
    expect(seen.temp).toBe('new');
    expect(seen.tempDir).toBe(dir);
    expect(seen.entries).toBe(2);

    expect(await readFile(path, 'utf8')).toBe('new');
    expect(await readdir(dir)).toEqual([basename(path)]);
  });

  it('never creates the temp sibling more openly than asked', async () => {
    // The scaffold writes `.env` — a signing ring
    // and a shared secret — through here. Setting
    // the mode after the rename would leave both
    // the temp file and, for an instant, the file
    // itself at the default 0644, which on a
    // shared host is the whole exposure.
    const secret = join(dir, 'secret.env');
    let temp = 0;

    await writeFileAtomic(secret, 'EVENTS_SECRET="s"\n', {
      mode: 0o600,
      beforeRename: async (tempPath) => {
        temp = (await stat(tempPath)).mode & 0o777;
      },
    });

    expect(temp).toBe(0o600);
    expect((await stat(secret)).mode & 0o777).toBe(0o600);
  });

  it('creates a file that was not there before', async () => {
    const fresh = join(dir, 'fresh.json');

    await writeFileAtomic(fresh, 'hello');

    expect(await readFile(fresh, 'utf8')).toBe('hello');
  });

  it('leaves no temp file behind when the rename fails', async () => {
    const blocked = join(dir, 'blocked');
    await mkdir(blocked);
    await writeFile(join(blocked, 'occupant'), '', 'utf8');

    await expect(writeFileAtomic(blocked, 'new')).rejects.toThrow();

    expect((await readdir(dir)).sort()).toEqual(['blocked', 'doc.json']);
  });
});
