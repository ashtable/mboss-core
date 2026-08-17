import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const MODULE_ROOT = import.meta.dirname;
const ENTRY = join(MODULE_ROOT, 'index.ts');

/**
 * Every module specifier in one file: static imports, type-only imports, `export … from`,
 * `import(…)` and `require(…)`. A regex over the source would be fooled by a string literal and
 * would miss the last two, so this uses the compiler's own parser.
 */
function specifiersOf(source: string): string[] {
  const file = ts.createSourceFile('m.ts', source, ts.ScriptTarget.ES2022, true);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.push(node.moduleReference.expression.text);
    }
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const [arg] = node.arguments;
      if ((isRequire || isDynamic) && arg && ts.isStringLiteral(arg)) found.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/** Resolves an ESM-style relative specifier (`./x.js`) to the TypeScript file on disk. */
function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(from, specifier);
  for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Walks everything reachable from `entry`, following relative imports only. External specifiers are
 * collected rather than followed; a relative import that resolves outside this module's directory
 * is recorded as an escape.
 */
function walk(entry: string): { external: string[]; escaped: string[]; visited: string[] } {
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
      // An unresolvable relative import must not be silently ignored: it would look like a clean
      // graph while actually meaning the walk failed to see part of it.
      if (!resolved) throw new Error(`cannot resolve ${specifier} from ${file}`);
      if (!resolved.startsWith(MODULE_ROOT + sep)) escaped.push(resolved);
      queue.push(resolved);
    }
  }

  return { external: [...new Set(external)].sort(), escaped, visited: [...visited] };
}

describe('the signed-links import graph', () => {
  it('reaches nothing outside node:crypto', () => {
    expect(walk(ENTRY).external).toEqual(['node:crypto']);
  });

  it('never leaves this directory by a relative import', () => {
    expect(walk(ENTRY).escaped).toEqual([]);
  });

  it('actually visited the entry point, so an empty result means clean rather than skipped', () => {
    const { visited } = walk(ENTRY);
    expect(visited).toContain(ENTRY);
    expect(visited.length).toBeGreaterThan(0);
  });

  it('finds every form of import, which is what makes the assertions above trustworthy', () => {
    const fixture = [
      "import a from 'static-import';",
      "import type { B } from 'type-only-import';",
      "export * from 'export-star';",
      "const c = await import('dynamic-import');",
      "const d = require('require-call');",
      "const notAnImport = 'this is only a string literal';",
    ].join('\n');

    expect(specifiersOf(fixture).sort()).toEqual([
      'dynamic-import',
      'export-star',
      'require-call',
      'static-import',
      'type-only-import',
    ]);
  });
});
