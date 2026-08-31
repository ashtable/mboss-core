import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { specifiersOf } from './test-support/specifiers.js';

const SRC = import.meta.dirname;

/**
 * Resolves an ESM-style relative specifier
 * (`./x.js`) to the TypeScript file on disk.
 */
function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(from, specifier);
  for (const candidate of [
    base.replace(/\.js$/, '.ts'),
    `${base}.ts`,
    join(base, 'index.ts'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Walks everything reachable from `entry`,
 * following relative imports only. External
 * specifiers are collected rather than followed;
 * a relative import that resolves outside
 * `boundary` is recorded as an escape.
 */
function walk(
  entry: string,
  boundary: string,
): {
  external: string[];
  escaped: string[];
  visited: string[];
} {
  const external: string[] = [];
  const escaped: string[] = [];
  const visited = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);

    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        external.push(specifier);
        continue;
      }
      const resolved = resolveRelative(join(file, '..'), specifier);
      // An unresolvable relative import must not
      // be silently ignored: it would look like a
      // clean graph while actually meaning the
      // walk failed to see part of it.
      if (!resolved)
        throw new Error(`cannot resolve ${specifier} from ${file}`);
      if (!resolved.startsWith(boundary + sep)) escaped.push(resolved);
      queue.push(resolved);
    }
  }

  return {
    external: [...new Set(external)].sort(),
    escaped,
    visited: [...visited],
  };
}

/**
 * A consumer aliases each of these directories on
 * its own, so what a directory can reach is the
 * promise it makes about the cost of nesting this
 * library.
 *
 * The email subpath's empty surface is the
 * strictest of the two and the one that is
 * load-bearing rather than tidy: the admin console
 * renders these templates live in the browser as
 * the author types, and a single `node:` import
 * anywhere in the graph would break that bundle.
 */
const SUBPATHS = [
  { name: 'signed-links', external: ['node:crypto'] },
  { name: 'email', external: [] },
];

describe.each(SUBPATHS)('the $name import graph', ({ name, external }) => {
  const dir = join(SRC, name);
  const entry = join(dir, 'index.ts');

  it('reaches nothing outside its declared external surface', () => {
    expect(walk(entry, dir).external).toEqual(external);
  });

  it('never leaves its directory by a relative import', () => {
    expect(walk(entry, dir).escaped).toEqual([]);
  });

  it('actually visited the entry point, so an empty result means clean rather than skipped', () => {
    const { visited } = walk(entry, dir);
    expect(visited).toContain(entry);
    expect(visited.length).toBeGreaterThan(0);
  });
});

/**
 * The scaffold's own graph.
 *
 * It ships a runtime tree — express, the DBOS SDK,
 * a Prisma client — and it must never *import*
 * one. Those files are read off disk with
 * `readFileSync`, so that nesting this library
 * costs a consumer nothing but what it already
 * pays for. An ordinary import would put all three
 * packages into the type graph of every repo that
 * uses the barrel.
 */
describe('the scaffold import graph', () => {
  const dir = join(SRC, 'scaffold');
  const entry = join(dir, 'index.ts');

  it('never imports the runtime tree it copies', () => {
    const { visited } = walk(entry, dir);
    const runtime = visited.filter(
      (file) =>
        file.startsWith(join(dir, 'app') + sep) ||
        file.startsWith(join(dir, 'workflows') + sep),
    );

    expect(visited.length).toBeGreaterThan(1);
    expect(runtime).toEqual([]);
  });

  it('keeps the packages that runtime needs out of its own surface', () => {
    const { external } = walk(entry, dir);

    // Non-vacuous: the scaffold does reach for
    // the filesystem, which is how it reads the
    // tree rather than importing it.
    expect(external).toContain('node:fs');
    for (const name of [
      'express',
      'pg',
      'dotenv',
      '@dbos-inc/dbos-sdk',
      '@dbos-inc/prisma-datasource',
      '@prisma/client',
      '@prisma/adapter-pg',
    ]) {
      expect(external).not.toContain(name);
    }
  });
});
