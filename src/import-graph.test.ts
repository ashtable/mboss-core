import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

import { ts } from 'ts-morph';
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
 * The one rule for whether a function fits a node.
 *
 * The picker, the drop target and validation all
 * have to give the same answer, so they all call
 * `handlerFit` — and the first two run in a webview
 * bundle. It reads the IR and the manifest's shapes
 * and nothing else: `manifest/index.ts` would bring
 * the scan and ts-morph with it, and reaching the
 * layout module would bring ELK.
 */
describe('the handler-fit import graph', () => {
  const entry = join(SRC, 'validate', 'handler-fit.ts');

  it('reaches nothing a browser cannot have', () => {
    const { external, visited } = walk(entry, SRC);

    // Non-vacuous: the walk really did read the
    // module, and really did follow it as far as
    // the manifest's shapes.
    expect(visited).toContain(entry);
    expect(visited).toContain(join(SRC, 'manifest', 'types.ts'));
    expect(external).toEqual(['zod']);
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

/**
 * The recorded-name grammar.
 *
 * `src/compile/names.ts` both renders the name a
 * step records and reads one back, and the reading
 * half is what tells a webview which block a row
 * in the ledger belongs to. So it is a leaf on
 * purpose — not even the id schema, whose shape it
 * restates in a comment rather than imports.
 */
describe('the recorded-name import graph', () => {
  const entry = join(SRC, 'compile', 'names.ts');

  it('imports nothing at all', () => {
    const { external, visited } = walk(entry, join(SRC, 'compile'));

    // Non-vacuous: the walk really did read the
    // module, and that one file is all it reached.
    expect(visited).toEqual([entry]);
    expect(external).toEqual([]);
  });
});

/**
 * The reads a filesystem call makes, and whether
 * each one waited to be asked.
 *
 * Written out rather than matched by prefix,
 * because the point is a closed list: a read this
 * does not know about is one nothing here would
 * catch.
 */
const FILESYSTEM_READS = new Set([
  'readFile',
  'readFileSync',
  'readdir',
  'readdirSync',
  'statSync',
]);

/** One call to one of those, and where it sits. */
type Read = { where: string; eager: boolean };

/**
 * Every filesystem read in a file, each marked
 * with whether it runs at import — that is,
 * whether nothing but module scope encloses it.
 */
function readsIn(file: string): Read[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Read[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;

      if (FILESYSTEM_READS.has(name)) {
        found.push({
          where: `${basename(file)}: ${name}`,
          eager: !insideFunction(node),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

function insideFunction(node: ts.Node): boolean {
  for (let up = node.parent; up !== undefined; up = up.parent) {
    if (ts.isFunctionLike(up)) return true;
  }

  return false;
}

/**
 * The pattern library's graph.
 *
 * `src/patterns/` ships a directory of documents
 * and handler sources beside itself and reads them
 * off disk. Reading them at import would put the
 * whole gallery into the cost of loading the
 * module — which the MCP server does to answer any
 * tool call at all, and the gallery is asked for
 * by almost none of them. So every read waits to
 * be called, and this checks it by parsing rather
 * than by reading the code.
 */
describe('the pattern library import graph', () => {
  const dir = join(SRC, 'patterns');
  const entry = join(dir, 'index.ts');

  it('reads the library only when it is asked to', () => {
    const own = walk(entry, dir).visited.filter((file) =>
      file.startsWith(dir + sep),
    );
    const reads = own.flatMap(readsIn);

    // Non-vacuous: the module really does read the
    // filesystem, so an empty second list means
    // lazy rather than misspelled.
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((read) => read.eager)).toEqual([]);
  });

  it('never imports the handlers it copies', () => {
    // They are a project's code, not this one's.
    // An import would bind this module to whatever
    // a pattern's handlers happen to import, and
    // would carry them into every bundle that
    // takes the barrel.
    const { visited } = walk(entry, dir);
    const library = visited
      .filter((file) => file.startsWith(join(dir, 'library') + sep))
      .map((file) => relative(SRC, file));

    expect(visited.length).toBeGreaterThan(1);
    expect(library).toEqual([]);
  });
});
