import { describe, expect, it } from 'vitest';

import { NODE_PALETTE } from '../ir/catalog.js';

import { TITLE_MAX_CHARS, nodeSize, truncateTitle } from './metrics.js';

describe('nodeSize', () => {
  it('gives every kind the same width', () => {
    const widths = NODE_PALETTE.map((entry) => nodeSize(entry.kind).width);

    expect(new Set(widths).size).toBe(1);
  });

  it('makes a kind with more config rows taller than one with fewer', () => {
    expect(nodeSize('emailSend').height).toBeGreaterThan(
      nodeSize('step').height,
    );
  });

  it('sizes every kind the palette offers', () => {
    for (const entry of NODE_PALETTE) {
      const { width, height } = nodeSize(entry.kind);

      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    }
  });
});

describe('truncateTitle', () => {
  it('leaves a short title untouched', () => {
    expect(truncateTitle('Find open slot')).toBe('Find open slot');
  });

  it('cuts a long title to the fixed length', () => {
    const long = 'x'.repeat(TITLE_MAX_CHARS + 20);

    expect([...truncateTitle(long)]).toHaveLength(TITLE_MAX_CHARS);
  });

  it('leaves a title of exactly the fixed length untouched', () => {
    const exact = 'x'.repeat(TITLE_MAX_CHARS);

    expect(truncateTitle(exact)).toBe(exact);
  });

  it('cuts on whole characters, so an emoji is never split in half', () => {
    const emoji = '🐕'.repeat(TITLE_MAX_CHARS);

    expect(truncateTitle(emoji)).not.toContain('�');
    expect([...truncateTitle(emoji)]).toHaveLength(TITLE_MAX_CHARS);
  });
});
