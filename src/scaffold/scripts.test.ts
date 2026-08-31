import { describe, expect, it } from 'vitest';

import { scaffoldFiles } from './files.js';

/**
 * The half a walk over the imports cannot see.
 *
 * `tsx` is the case that matters. Nothing imports
 * it: the container's entrypoint execs
 * `./node_modules/.bin/tsx`, so leaving it out of
 * the dependency block fails at container start,
 * where neither a type-check nor an import walk
 * has anything to say about it.
 */

const FILES = scaffoldFiles({ name: 'my_app' });

function contentsOf(path: string): string {
  const found = FILES.find((file) => file.path === path);
  if (!found) throw new Error(`nothing emitted at ${path}`);

  return found.contents;
}

type PackageJson = {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const PACKAGE = JSON.parse(contentsOf('package.json')) as PackageJson;
const DECLARED = { ...PACKAGE.dependencies, ...PACKAGE.devDependencies };

/**
 * Which binary a command line runs, for each
 * command in it. `npx` and `exec` name their
 * binary one word later, and a path into
 * `node_modules/.bin` names it at the end.
 */
function binariesIn(command: string): string[] {
  return command
    .split(/&&|\|\||;/)
    .map((part) => part.trim().split(/\s+/))
    .flatMap((words) => {
      const first = words[0] ?? '';
      const named = first === 'npx' || first === 'exec' ? words[1] : first;

      return named === undefined ? [] : [named];
    })
    .map((word) => word.replace('./node_modules/.bin/', ''))
    .filter((word) => word.length > 0 && !word.startsWith('-'));
}

/** Binaries whose package is not called the same
 *  thing as the command. */
const PACKAGE_OF_BINARY: Record<string, string> = { tsc: 'typescript' };

/**
 * The Railway command-line tool is installed once
 * on a machine, not once per project, so it is the
 * one command here that no `package.json` should
 * declare.
 */
const NOT_A_PACKAGE = new Set(['railway']);

function packagesRun(command: string): string[] {
  return binariesIn(command)
    .filter((binary) => !NOT_A_PACKAGE.has(binary))
    .map((binary) => PACKAGE_OF_BINARY[binary] ?? binary);
}

const ENTRYPOINT = contentsOf('docker-entrypoint.sh')
  .split('\n')
  .filter((line) => !line.startsWith('#') && !line.startsWith('set '))
  .join('\n');

describe('binariesIn', () => {
  it('reads a plain command, a chain, an npx call and a local binary', () => {
    expect(binariesIn('vitest run')).toEqual(['vitest']);
    expect(binariesIn('tsc --noEmit && eslint .')).toEqual(['tsc', 'eslint']);
    expect(binariesIn('npx prisma migrate deploy')).toEqual(['prisma']);
    expect(binariesIn('exec ./node_modules/.bin/tsx src/app/main.ts')).toEqual([
      'tsx',
    ]);
  });
});

describe('every tool a script names', () => {
  const RUN = [
    ...new Set([
      ...Object.values(PACKAGE.scripts).flatMap(packagesRun),
      ...packagesRun(ENTRYPOINT),
    ]),
  ].sort();

  it('is a real list, not an empty one', () => {
    expect(RUN).toEqual([
      'eslint',
      'prettier',
      'prisma',
      'tsx',
      'typescript',
      'vitest',
    ]);
  });

  it.each(RUN)('%s is declared by the project itself', (name) => {
    expect(DECLARED).toHaveProperty(name);
  });
});

describe('tsx', () => {
  it('is a runtime dependency, because the container execs it', () => {
    // An install that omitted development
    // dependencies would otherwise leave the
    // container with nothing to run, and the
    // failure arrives at start rather than at
    // build.
    expect(PACKAGE.dependencies).toHaveProperty('tsx');
    expect(PACKAGE.devDependencies).not.toHaveProperty('tsx');
  });
});

describe('prisma and dotenv', () => {
  it('stay development dependencies, so the image keeps them', () => {
    // Which is why the Dockerfile does not pass
    // --omit=dev: the entrypoint runs prisma and
    // the config imports dotenv.
    expect(PACKAGE.devDependencies).toHaveProperty('prisma');
    expect(PACKAGE.devDependencies).toHaveProperty('dotenv');
    const instructions = contentsOf('Dockerfile')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'));

    expect(instructions.join('\n')).not.toContain('--omit=dev');
  });
});
