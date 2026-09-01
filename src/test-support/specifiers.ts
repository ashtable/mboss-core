import ts from 'typescript';

/**
 * Reading module specifiers out of TypeScript
 * source, for the tests that assert what a file is
 * allowed to import and how it is allowed to spell
 * it.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 *
 * It imports the `typescript` devDependency
 * rather than ts-morph's bundled copy. That is
 * fine here and would not be in `src/compile/`:
 * shipped code cannot reach for a devDependency,
 * and a test can.
 */

/**
 * Every module specifier in one file: static
 * imports, type-only imports, `export … from`,
 * `import(…)` and `require(…)`. A regex over the
 * source would be fooled by a string literal and
 * would miss the last two, so this uses the
 * compiler's own parser.
 */
export function specifiersOf(source: string): string[] {
  const file = ts.createSourceFile(
    'm.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
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
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const [arg] = node.arguments;
      if ((isRequire || isDynamic) && arg && ts.isStringLiteral(arg))
        found.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/**
 * The relative specifiers in `source` that do not
 * end in `.js`, which is every one of them that
 * Node will refuse to resolve.
 *
 * The generated project runs its TypeScript
 * directly, and `moduleResolution: "bundler"`
 * happily accepts `'../app/db'` — so nothing in a
 * type-check or a golden notices, and the app
 * throws ERR_MODULE_NOT_FOUND at boot instead.
 * Bare and `node:` specifiers carry no extension
 * and are left alone.
 */
export function relativeSpecifiersEndInJs(source: string): string[] {
  return specifiersOf(source).filter(
    (specifier) => specifier.startsWith('.') && !specifier.endsWith('.js'),
  );
}

/**
 * The package a specifier names, or `null` when it
 * names no package at all.
 *
 * A subpath is dropped and a scope is kept, so
 * `prisma/config` is declared by `prisma` while
 * `@prisma/adapter-pg` is its own package.
 * Relative and `node:` specifiers are declared by
 * nobody.
 */
export function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return null;

  const parts = specifier.split('/');
  const name = specifier.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : parts[0];

  return name ?? null;
}
