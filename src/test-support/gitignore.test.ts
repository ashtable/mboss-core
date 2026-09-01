import { describe, expect, it } from 'vitest';

import { isIgnored, parseIgnoreFile } from './gitignore.js';

/**
 * The matcher, before anything trusts it.
 *
 * It reimplements a small corner of git, so every
 * rule it claims to know is pinned here against a
 * case whose real answer is not in doubt.
 */

const PATTERNS = parseIgnoreFile(`# a comment
node_modules/
coverage/
*.tsbuildinfo
.DS_Store
.env

.mboss/proposals/
.mboss/manifest.json
`);

describe('parseIgnoreFile', () => {
  it('drops comments and blank lines', () => {
    expect(PATTERNS).toHaveLength(7);
  });

  it('refuses a negation rather than mishandling it', () => {
    // Nothing this repo emits carries one, and a
    // matcher that silently ignored `!` would
    // report a path as ignored when git does not.
    expect(() => parseIgnoreFile('*.log\n!keep.log\n')).toThrow(/negation/);
  });
});

describe('isIgnored', () => {
  it('matches a bare name at any depth', () => {
    expect(isIgnored(PATTERNS, '.DS_Store')).toBe(true);
    expect(isIgnored(PATTERNS, 'src/app/.DS_Store')).toBe(true);
  });

  it('matches everything under an ignored directory', () => {
    expect(isIgnored(PATTERNS, 'node_modules/')).toBe(true);
    expect(isIgnored(PATTERNS, 'node_modules/zod/index.js')).toBe(true);
  });

  it('keeps a directory-only pattern off a file of the same name', () => {
    expect(isIgnored(parseIgnoreFile('build/\n'), 'build')).toBe(false);
    expect(isIgnored(parseIgnoreFile('build/\n'), 'build/')).toBe(true);
  });

  it('expands a star inside one segment and no further', () => {
    expect(isIgnored(PATTERNS, 'app.tsbuildinfo')).toBe(true);
    expect(isIgnored(PATTERNS, 'src/app.tsbuildinfo')).toBe(true);
    expect(isIgnored(parseIgnoreFile('a/*.log\n'), 'a/b/c.log')).toBe(false);
  });

  it('anchors a pattern that carries a slash', () => {
    expect(isIgnored(PATTERNS, '.mboss/proposals/x.json')).toBe(true);
    expect(isIgnored(PATTERNS, 'nested/.mboss/proposals/x.json')).toBe(false);
  });

  it('will not let a longer pattern match a shorter path', () => {
    const patterns = parseIgnoreFile('a/*\n');

    expect(isIgnored(patterns, 'a/')).toBe(false);
    expect(isIgnored(patterns, 'a/b.txt')).toBe(true);
  });

  it('does not treat a prefix as a match', () => {
    // The one that matters most here: `.env` is
    // ignored and `.env.example` is committed.
    expect(isIgnored(PATTERNS, '.env')).toBe(true);
    expect(isIgnored(PATTERNS, '.env.example')).toBe(false);
    expect(isIgnored(PATTERNS, '.mboss/manifest.json.bak')).toBe(false);
  });

  it('says nothing is ignored when nothing is listed', () => {
    expect(isIgnored([], 'anything/at/all')).toBe(false);
  });
});
