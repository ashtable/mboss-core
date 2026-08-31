import { describe, expect, it } from 'vitest';

import { SourceWriter } from './source.js';

describe('SourceWriter', () => {
  it('writes lines at the current indent', () => {
    const writer = new SourceWriter();

    writer.line('const a = 1;');
    writer.open('function f() {');
    writer.line('return 2;');
    writer.close('}');

    expect(writer.toString()).toBe(
      ['const a = 1;', 'function f() {', '  return 2;', '}', ''].join('\n'),
    );
  });

  it('writes an empty line for a bare line()', () => {
    const writer = new SourceWriter();

    writer.open('{');
    writer.line('a');
    writer.line();
    writer.line('b');
    writer.close('}');

    expect(writer.toString()).toBe(['{', '  a', '', '  b', '}', ''].join('\n'));
  });

  it('drops a blank line that would sit above a closing brace', () => {
    // Prettier deletes one, so leaving it there
    // would mean emitting source that is not
    // already formatted.
    const writer = new SourceWriter();

    writer.open('{');
    writer.line('a');
    writer.blank();
    writer.close('}');

    expect(writer.toString()).toBe(['{', '  a', '}', ''].join('\n'));
  });

  it('collapses consecutive blanks to one', () => {
    const writer = new SourceWriter();

    writer.line('a');
    writer.blank();
    writer.blank();
    writer.blank();
    writer.line('b');

    expect(writer.toString()).toBe(['a', '', 'b', ''].join('\n'));
  });

  it('never opens with a blank line', () => {
    const writer = new SourceWriter();

    writer.blank();
    writer.line('a');

    expect(writer.toString()).toBe('a\n');
  });

  it('ends with exactly one newline, whatever it was fed', () => {
    const writer = new SourceWriter();

    writer.line('a');
    writer.blank();
    writer.blank();

    expect(writer.toString()).toBe('a\n');
  });

  it('never throws on a line wider than the house limit', () => {
    // Emitted width depends on node ids and type
    // names a person chose. A writer that refused
    // one would turn codegen into a hard failure
    // in somebody's project; width is a test-time
    // audit instead.
    const writer = new SourceWriter();
    const wide = `const ${'x'.repeat(200)} = 1;`;

    expect(() => writer.line(wide)).not.toThrow();
    expect(writer.toString()).toBe(`${wide}\n`);
  });

  it('starts at the indent it was given', () => {
    // A fragment pasted inside something else has
    // to measure its own lines from where they
    // will end up, not from column zero.
    const writer = new SourceWriter(2);

    writer.line('a');

    expect(writer.toString()).toBe('  a\n');
    expect(writer.fits('x'.repeat(79))).toBe(false);
  });

  it('answers whether a line would fit at the current indent', () => {
    const writer = new SourceWriter();

    expect(writer.fits('x'.repeat(80))).toBe(true);
    expect(writer.fits('x'.repeat(81))).toBe(false);

    writer.open('{');

    expect(writer.fits('x'.repeat(78))).toBe(true);
    expect(writer.fits('x'.repeat(79))).toBe(false);
  });

  it('hard-wraps a comment to fifty columns from column zero', () => {
    const writer = new SourceWriter();

    writer.comment(
      'The quick brown fox jumps over the lazy dog and ' +
        'then it keeps on running for a while longer.',
    );

    const lines = writer.toString().split('\n').slice(0, -1);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.startsWith('// ')).toBe(true);
      expect([...line].length).toBeLessThanOrEqual(50);
    }
    expect(lines.join(' ').replaceAll('// ', '')).toBe(
      'The quick brown fox jumps over the lazy dog and ' +
        'then it keeps on running for a while longer.',
    );
  });

  it('counts the indent against the comment budget', () => {
    const writer = new SourceWriter();

    writer.open('function f() {');
    writer.comment(
      'The quick brown fox jumps over the lazy dog and then some more.',
    );
    writer.close('}');

    for (const line of writer.toString().split('\n')) {
      expect([...line].length).toBeLessThanOrEqual(50);
    }
  });

  it('leaves a word longer than the budget on its own line', () => {
    // A path or a URL does not wrap. Breaking it
    // would produce two lines that neither read
    // nor resolve.
    const writer = new SourceWriter();
    const long = 'a'.repeat(70);

    writer.comment(`see ${long} for more`);

    expect(writer.toString()).toBe(
      ['// see', `// ${long}`, '// for more', ''].join('\n'),
    );
  });
});
