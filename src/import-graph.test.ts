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

/**
 * The shared graph edits.
 *
 * `src/ir/edit.ts` is the one copy of what it
 * means to rename, delete, start or rewire a
 * block, and the extension imports it into a
 * webview bundle. A relative import that reached
 * into `apply/` would drag the apply engine — its
 * locks, its atomic writes, `node:fs` — into that
 * bundle, so the module takes its document
 * arguments as structural types and stays inside
 * `ir/`.
 */
describe('the graph edits import graph', () => {
  const dir = join(SRC, 'ir');
  const entry = join(dir, 'edit.ts');

  it('reaches nothing a browser cannot have', () => {
    const { external, visited } = walk(entry, dir);

    expect(visited).toContain(entry);
    expect(external).toEqual(['zod']);
  });

  it('never leaves the IR by a relative import', () => {
    expect(walk(entry, dir).escaped).toEqual([]);
  });
});

/**
 * The compiler's own graph.
 *
 * `src/compile/` is shipped source that the MCP
 * server and the extension consume, so it may not
 * reach for a devDependency: it parses and
 * type-checks with the compiler ts-morph bundles,
 * which is an ordinary runtime dependency. It also
 * emits imports of the DBOS SDK, Express and a
 * Prisma client without importing any of them — a
 * generated project needs those, and a library
 * that nests this one does not.
 */
describe('the compiler import graph', () => {
  const dir = join(SRC, 'compile');
  const entry = join(dir, 'index.ts');

  it('parses with the compiler ts-morph brings, not the devDependency', () => {
    const { external, visited } = walk(entry, dir);

    expect(visited.length).toBeGreaterThan(1);
    expect(external).toContain('ts-morph');
    expect(external).not.toContain('typescript');
  });

  it('imports none of the packages it emits imports of', () => {
    const { external } = walk(entry, dir);

    for (const name of [
      'express',
      'prettier',
      '@dbos-inc/dbos-sdk',
      '@dbos-inc/prisma-datasource',
      '@prisma/client',
    ]) {
      expect(external).not.toContain(name);
    }
  });
});
