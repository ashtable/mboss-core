import { describe, expect, it } from 'vitest';

import { isIgnored, parseIgnoreFile } from '../test-support/gitignore.js';

import { scaffoldFiles } from './files.js';

/**
 * What a new project commits, and what it does
 * not.
 *
 * Asked as questions about paths rather than as a
 * comparison against the file's text: a string
 * compare proves the file did not change, not that
 * it means what it should. And this file is the
 * deploy manifest as well as the ignore list —
 * `railway up` honours it — so a path wrongly
 * listed here is a file that never reaches the
 * running service.
 */

const emitted = scaffoldFiles({ name: 'my_app' });
const gitignore = emitted.find((file) => file.path === '.gitignore');
const PATTERNS = parseIgnoreFile(gitignore?.contents ?? '');

describe('the emitted .gitignore', () => {
  it('was found at all, so an empty pattern list means something', () => {
    expect(PATTERNS.length).toBeGreaterThan(0);
  });

  it.each([
    '.mboss/proposals/',
    '.mboss/history/',
    '.mboss/manifest.json',
    '.mboss/state.json',
    '.mboss/.lock',
  ])('ignores %s, which is derived or transient', (path) => {
    expect(isIgnored(PATTERNS, path)).toBe(true);
  });

  it.each([
    '.mboss/workflows/',
    '.mboss/workflows/groom_booking.workflow.json',
    '.mboss/mcp/',
    '.mboss/skills/',
    '.mboss/conventions.md',
    'src/workflows/',
    'src/workflows/index.ts',
    'src/app/',
    'src/app/contract.ts',
    'lib/',
    'prisma/schema.prisma',
    '.env.example',
  ])('commits %s', (path) => {
    expect(isIgnored(PATTERNS, path)).toBe(false);
  });

  it('keeps the environment file itself out of git and out of a deploy', () => {
    expect(isIgnored(PATTERNS, '.env')).toBe(true);
  });

  it('ignores the ordinary build leftovers', () => {
    expect(isIgnored(PATTERNS, 'node_modules/zod/index.js')).toBe(true);
    expect(isIgnored(PATTERNS, 'coverage/index.html')).toBe(true);
    expect(isIgnored(PATTERNS, 'tsconfig.tsbuildinfo')).toBe(true);
  });

  it('ignores nothing else the scaffold itself writes', () => {
    // Every file a project is created with has to
    // survive `git add .` and reach a deploy. This
    // is the check that catches a new ignore
    // entry that is broader than it looks.
    const swallowed = emitted
      .map((file) => file.path)
      .filter((path) => path !== '.env')
      .filter((path) => isIgnored(PATTERNS, path));

    expect(swallowed).toEqual([]);
  });
});
