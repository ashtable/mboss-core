import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixturesRoot } from '../test-support/fixtures.js';
import { loadOrScan } from './cache.js';
import { scanLib } from './scan.js';

let projectDir: string;
let cachePath: string;

/**
 * A counting wrapper around the real scanner. The
 * point of the injected seam is that "the rescan
 * did not happen" is proved exactly, rather than
 * inferred from how long a call took or from a
 * timestamp that may not have moved.
 */
function countingScan(): { scan: typeof scanLib; calls: () => number } {
  const scan = vi.fn(scanLib);
  return { scan, calls: () => scan.mock.calls.length };
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mboss-'));
  cachePath = join(projectDir, '.mboss', 'manifest.json');
  cpSync(join(fixturesRoot, 'lib'), join(projectDir, 'lib'), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('loadOrScan', () => {
  it('scans and writes the cache the first time', () => {
    const { scan, calls } = countingScan();

    const manifest = loadOrScan(projectDir, { scan });

    expect(calls()).toBe(1);
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toEqual(manifest);
  });

  it('does not scan again while the sources are unchanged', () => {
    const { scan, calls } = countingScan();

    const first = loadOrScan(projectDir, { scan });
    const second = loadOrScan(projectDir, { scan });

    expect(calls()).toBe(1);
    expect(second).toEqual(first);
  });

  it('scans again once a lib file changes', () => {
    const { scan, calls } = countingScan();

    loadOrScan(projectDir, { scan });
    writeFileSync(
      join(projectDir, 'lib', 'recordBooking.ts'),
      '/** Renamed. */\nexport function noteBooking(): void {}\n',
    );
    const rescanned = loadOrScan(projectDir, { scan });

    expect(calls()).toBe(2);
    expect(rescanned.functions.map((fn) => fn.export)).toContain('noteBooking');
  });

  it('scans rather than throwing when the cache file is unreadable', () => {
    const { scan, calls } = countingScan();

    mkdirSync(join(projectDir, '.mboss'), { recursive: true });
    writeFileSync(cachePath, '{ this is not json');

    expect(loadOrScan(projectDir, { scan }).functions.length).toBeGreaterThan(
      0,
    );
    expect(calls()).toBe(1);
  });

  it('scans rather than trusting a cache file of the wrong shape', () => {
    const { scan, calls } = countingScan();

    mkdirSync(join(projectDir, '.mboss'), { recursive: true });
    writeFileSync(cachePath, '{"sourceHash": 12, "functions": "none"}');

    expect(loadOrScan(projectDir, { scan }).functions.length).toBeGreaterThan(
      0,
    );
    expect(calls()).toBe(1);
  });

  it('rescans a cache written before the shape gained a field', () => {
    // This is what an upgrade looks like from
    // disk: a cache that is entirely well formed
    // and merely older. It is rejected on shape
    // rather than on a version number, which is
    // why no version number is written.
    const { scan, calls } = countingScan();

    loadOrScan(projectDir, { scan });

    const stale = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<
      string,
      unknown
    >;
    delete stale['nonSerializable'];
    writeFileSync(cachePath, JSON.stringify(stale));

    expect(loadOrScan(projectDir, { scan }).nonSerializable).toEqual([]);
    expect(calls()).toBe(2);
  });

  /**
   * Git does not track an empty directory and the
   * scaffold writes a file per handler-bearing
   * node, so a draft with no handlers yet reaches
   * a teammate's clone with no `lib/` at all.
   * Whoever opens the canvas then gets whatever
   * this call does.
   */
  it('reads a project with no lib directory as an empty manifest', () => {
    rmSync(join(projectDir, 'lib'), { recursive: true, force: true });

    const manifest = loadOrScan(projectDir);

    expect(manifest.functions).toEqual([]);
    expect(manifest.types).toEqual([]);
    expect(manifest.errors).toEqual([]);
  });

  it('defaults to the real scanner when no seam is injected', () => {
    expect(loadOrScan(projectDir).functions.map((fn) => fn.export)).toContain(
      'findSlot',
    );
  });
});
