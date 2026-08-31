import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { RUNTIME } from '../app-contract/runtime.js';
import { specifiersOf } from '../test-support/specifiers.js';

/**
 * The compiler's idea of the runtime, checked
 * against the runtime.
 *
 * `RUNTIME` says which modules a generated
 * workflow may import and which of their exports
 * it may name. Nothing else compares the two, so
 * without this a renamed export would first be
 * noticed as a type error inside a generated file
 * that nobody wrote.
 *
 * This test may read both trees. It is in
 * `scaffold/` rather than `app-contract/` for that
 * reason: `app-contract` holds constants and pure
 * functions and reads no files at all.
 */

const APP_SOURCES = join(import.meta.dirname, 'app');

function fileFor(specifier: string): string {
  const name = specifier.replace('../app/', '').replace(/\.js$/, '.ts');

  return join(APP_SOURCES, name);
}

/** Every name a module exports, by any spelling. */
function exportedNames(source: string): string[] {
  const file = ts.createSourceFile(
    'm.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const found: string[] = [];

  for (const statement of file.statements) {
    const exported = ts
      .getModifiers(statement as ts.HasModifiers)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    if (
      exported &&
      (ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      found.push(statement.name.text);
    }

    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const { name } = declaration;
        if (ts.isIdentifier(name)) found.push(name.text);
      }
    }

    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          found.push(element.name.text);
        }
      }
    }
  }

  return found;
}

const MODULES = Object.entries(RUNTIME);
const written = MODULES.filter(([, entry]) =>
  existsSync(fileFor(entry.specifier)),
);

describe('the runtime table against the runtime', () => {
  it('has every module the table names, so none is checked vacuously', () => {
    const missing = MODULES.filter(
      ([, entry]) => !existsSync(fileFor(entry.specifier)),
    ).map(([name]) => name);

    expect(missing).toEqual([]);
    expect(written).toHaveLength(MODULES.length);
  });

  it.each(written)('%s exports every name the table claims', (_name, entry) => {
    const source = readFileSync(fileFor(entry.specifier), 'utf8');
    const names = exportedNames(source);

    for (const claimed of entry.exports) expect(names).toContain(claimed);
  });
});

describe('the contract file', () => {
  const source = readFileSync(fileFor(RUNTIME.contract.specifier), 'utf8');

  it('exports exactly what the table says, no more and no less', () => {
    expect(exportedNames(source).sort()).toEqual([...RUNTIME.contract.exports]);
  });

  it('imports nothing at all', () => {
    expect(specifiersOf(source)).toEqual([]);
  });

  it('declares types and nothing else, so none of it reaches runtime', () => {
    const file = ts.createSourceFile(
      'contract.ts',
      source,
      ts.ScriptTarget.ES2022,
      true,
    );

    for (const statement of file.statements) {
      expect(ts.isTypeAliasDeclaration(statement)).toBe(true);
    }
  });
});
