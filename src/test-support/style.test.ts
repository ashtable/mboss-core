import { describe, expect, it } from 'vitest';

import {
  citationProblems,
  controlProblems,
  expectHouseStyle,
  widthProblems,
} from './style.js';

/**
 * Samples assert their own width before they are
 * used. A miscounted sample would silently turn
 * the test that reads it into a test of nothing.
 */
const CODE_81 = `const value = '${'x'.repeat(64)}';`;
const PROSE_51 = 'a'.repeat(47) + ' end';
const TOKEN_70 = 'x'.repeat(70);

describe('the samples themselves', () => {
  it('are the widths the tests below claim', () => {
    expect(CODE_81).toHaveLength(81);
    expect(PROSE_51).toHaveLength(51);
    expect(TOKEN_70).toHaveLength(70);
  });
});

describe('widthProblems', () => {
  it('reports a code line over 80 columns', () => {
    const found = widthProblems(CODE_81, 'src/app/main.ts');

    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
    expect(found[0]?.why).toContain('80');
  });

  it('accepts a code line of exactly 80 columns', () => {
    expect(widthProblems(`const v = '${'x'.repeat(67)}';`, 'a.ts')).toEqual([]);
  });

  it('counts an em-dash as one column, not as its bytes', () => {
    const line = `const v = '${'—'.repeat(67)}';`;

    expect(line).toHaveLength(80);
    expect(widthProblems(line, 'a.ts')).toEqual([]);
  });

  it('counts characters, not the UTF-16 units they take', () => {
    const line = `const v = '${'🙂'.repeat(34)}';`;

    expect(line.length).toBeGreaterThan(80);
    expect(widthProblems(line, 'a.ts')).toEqual([]);
  });

  it('measures a comment by its prose, not by its indent', () => {
    const prose = `${'a'.repeat(44)} end`;
    const source = ['function f() {', `  // ${prose}`, '}'].join('\n');

    expect(prose).toHaveLength(48);
    expect(source.split('\n')[1]).toHaveLength(53);
    expect(widthProblems(source, 'a.ts')).toEqual([]);
  });

  it('reports an over-long comment line once, not twice', () => {
    const line = `// ${'a'.repeat(78)} b`;

    expect(line).toHaveLength(83);
    expect(widthProblems(line, 'a.ts')).toHaveLength(1);
  });

  it('counts an indented line from its indent, not from its code', () => {
    const line = `  const value = '${'x'.repeat(62)}';`;

    expect(line).toHaveLength(81);
    expect(line.trimStart()).toHaveLength(79);
    expect(widthProblems(line, 'a.ts')).toHaveLength(1);
  });

  it('reports a prose comment over 50 columns', () => {
    const found = widthProblems(`// ${PROSE_51}`, 'src/app/main.ts');

    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain('50');
  });

  it('leaves an unbreakable single-token comment alone', () => {
    expect(widthProblems(`// ${TOKEN_70}`, 'src/app/main.ts')).toEqual([]);
  });

  it('checks a jsdoc continuation line, which is most of the prose', () => {
    const source = ['/**', ` * ${PROSE_51}`, ' */'].join('\n');
    const found = widthProblems(source, 'src/app/contract.ts');

    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
  });

  it('reports a 51-column # comment in a compose file', () => {
    const found = widthProblems(`# ${PROSE_51}`, 'docker-compose.yml');

    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain('50');
  });

  it('reports a 51-column // comment in a prisma schema', () => {
    const found = widthProblems(`// ${PROSE_51}`, 'prisma/schema.prisma');

    expect(found).toHaveLength(1);
  });

  it('reports a 51-column # comment in an env file', () => {
    expect(widthProblems(`# ${PROSE_51}`, '.env.example')).toHaveLength(1);
  });

  it('reports a 51-column # comment in the Dockerfile', () => {
    expect(widthProblems(`# ${PROSE_51}`, 'Dockerfile')).toHaveLength(1);
  });

  it('reports a 51-column -- comment in a migration', () => {
    const path = 'prisma/migrations/0_init/migration.sql';

    expect(widthProblems(`-- ${PROSE_51}`, path)).toHaveLength(1);
  });

  it('does not apply the comment rule to a # line in markdown', () => {
    expect(widthProblems(`# ${PROSE_51}`, 'README.md')).toEqual([]);
  });

  it('does not apply the comment rule to a // line in json', () => {
    expect(widthProblems(`// ${PROSE_51}`, 'package.json')).toEqual([]);
  });

  it('still applies the 80-column rule to markdown and json', () => {
    expect(widthProblems(CODE_81, 'README.md')).toHaveLength(1);
    expect(widthProblems(CODE_81, 'package.json')).toHaveLength(1);
  });

  it('does not treat a trailing comment as a comment line', () => {
    expect(widthProblems(`const v = 1; // ${PROSE_51}`, 'a.ts')).toEqual([]);
  });
});

describe('citationProblems', () => {
  it('reports a section sign in a comment', () => {
    const found = citationProblems('// See §7.7 for why.', 'src/app/db.ts');

    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain('§');
  });

  it('reports a decision marker in a comment', () => {
    expect(citationProblems('// [D14] says so.', 'a.ts')).toHaveLength(1);
  });

  it('reports a mockup id in a comment', () => {
    const found = citationProblems('// The 4k mockup shows this.', 'a.ts');

    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain('4k');
  });

  it('leaves a mockup id inside a string literal alone', () => {
    expect(citationProblems("const label = '4k';", 'a.ts')).toEqual([]);
  });

  it('leaves ordinary comment prose alone', () => {
    const source = [
      '// The wait sleeps for 7 days, and 0.0.5 is',
      '// the version this shipped in.',
    ].join('\n');

    expect(citationProblems(source, 'a.ts')).toEqual([]);
  });

  it('checks the whole line in markdown, which has no comment syntax', () => {
    expect(citationProblems('See §11 for the env set.', 'README.md')).toEqual([
      expect.objectContaining({ line: 1 }),
    ]);
  });

  it('reports a citation in a # comment', () => {
    expect(citationProblems('# See §11.', 'docker-compose.yml')).toHaveLength(
      1,
    );
  });
});

describe('controlProblems', () => {
  it('reports a NUL byte, which nothing else in the lint chain sees', () => {
    const found = controlProblems('const a = 1;\u0000');

    expect(found).toHaveLength(1);
    expect(found[0]?.why).toContain('U+0000');
  });

  it('reports a carriage return', () => {
    expect(controlProblems('const a = 1;\r\n')).toHaveLength(1);
  });

  it('leaves tabs and newlines alone', () => {
    expect(controlProblems('a\n\tb\n')).toEqual([]);
  });
});

describe('expectHouseStyle', () => {
  it('throws on a file that breaks any one of the three rules', () => {
    expect(() => expectHouseStyle(CODE_81, 'a.ts')).toThrow(/81/);
    expect(() => expectHouseStyle('// §7', 'a.ts')).toThrow(/§/);
    expect(() => expectHouseStyle('a\u0000', 'a.ts')).toThrow(/U\+0000/);
  });

  it('names the file it is complaining about', () => {
    let message = '';
    try {
      expectHouseStyle(CODE_81, 'src/workflows/groom_booking.workflow.ts');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('src/workflows/groom_booking.workflow.ts');
  });

  it('says nothing about a clean file', () => {
    const source = ['// A comment that fits.', "const value = 'ok';", ''].join(
      '\n',
    );

    expect(() => expectHouseStyle(source, 'a.ts')).not.toThrow();
  });
});
