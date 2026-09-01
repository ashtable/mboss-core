import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { specifiersOf } from '../../test-support/specifiers.js';

/**
 * The files a project gets that this repository
 * already had.
 *
 * Five modules are copied rather than adapted:
 * the signed-link implementation and the four
 * leaves of the email render layer. A generated
 * app has to mint and verify tokens the cloud
 * services can also read, and a copy that drifted
 * would be a link that verifies in one place and
 * not the other — a failure nobody would look for
 * in a template.
 *
 * These tests are the only thing holding the two
 * sides together, so they compare bytes rather
 * than behaviour.
 */

const HERE = import.meta.dirname;
const CORE = join(HERE, '../..');

const COPIES = [
  { copy: 'signed-links.ts', original: 'signed-links/index.ts' },
  { copy: 'email/tokens.ts', original: 'email/tokens.ts' },
  { copy: 'email/html.ts', original: 'email/html.ts' },
  { copy: 'email/message.ts', original: 'email/message.ts' },
  { copy: 'email/markdown.ts', original: 'email/markdown.ts' },
];

describe.each(COPIES)('$copy', ({ copy, original }) => {
  it(`is byte-identical to ${original}`, () => {
    const vendored = readFileSync(join(HERE, copy), 'utf8');

    expect(vendored).toBe(readFileSync(join(CORE, original), 'utf8'));
  });
});

describe('the vendored signed links', () => {
  const source = readFileSync(join(HERE, 'signed-links.ts'), 'utf8');

  it('reaches node:crypto and nothing else', () => {
    // The copy is one file with no relative
    // imports, so its own specifier list is the
    // whole graph reachable from it. A byte-match
    // against the original would not notice
    // somebody editing both files at once, which
    // is why this is asserted here as well as
    // against the original.
    expect(specifiersOf(source)).toEqual(['node:crypto']);
  });

  it('imports nothing relative, so there is no rest of the graph', () => {
    const relative = specifiersOf(source).filter((s) => s.startsWith('.'));

    expect(relative).toEqual([]);
  });
});
