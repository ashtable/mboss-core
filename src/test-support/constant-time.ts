import ts from 'typescript';

/**
 * Whether a secret comparison is written in
 * constant time, read out of the source.
 *
 * Nothing observable separates
 * `timingSafeEqual(a, b)` behind a length check
 * from a plain `a === b`: the same answer for
 * every input, the same status code, the same
 * body. The difference is how long the wrong
 * answer takes, and a timing measurement in a test
 * suite is a flake waiting to happen — so the
 * property is checked as text instead.
 *
 * That is the trade `boot-order.ts` makes for the
 * same reason, and it is worth making here because
 * the comparison it guards is the only gate on the
 * two routes that can start a workflow.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */

const CRYPTO = 'node:crypto';
const SAFE_EQUAL = 'timingSafeEqual';

/**
 * Whether a source names `timingSafeEqual` among
 * its imports from `node:crypto`.
 */
function importsSafeEqual(file: ts.SourceFile): boolean {
  return file.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement)) return false;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return false;
    if (statement.moduleSpecifier.text !== CRYPTO) return false;

    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) return false;

    return bindings.elements.some(
      (element) => element.name.text === SAFE_EQUAL,
    );
  });
}

/**
 * The function written under a name, however it is
 * written.
 *
 * A declaration and a `const` holding an arrow are
 * the same thing to a reader, and reporting the
 * second as missing would send whoever hit it
 * looking for the wrong problem.
 */
function functionNamed(
  file: ts.SourceFile,
  name: string,
): ts.FunctionLikeDeclaration | undefined {
  let found: ts.FunctionLikeDeclaration | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found ??= node;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      found ??= node.initializer;
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/** Every node under one, itself included. */
function within(root: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [root];

  const visit = (node: ts.Node): void => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(root, visit);
  return nodes;
}

/**
 * Whether a function calls `timingSafeEqual`
 * anywhere inside itself.
 */
function callsSafeEqual(fn: ts.FunctionLikeDeclaration): boolean {
  return within(fn).some(
    (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === SAFE_EQUAL,
  );
}

/**
 * Whether a function compares two of its own
 * parameters with `===` or `!==`.
 *
 * This is the regression the call check alone
 * would miss: an early bail added for speed keeps
 * every line the rule looks for and hands the
 * answer over before reaching them. Comparing
 * something *derived* from the parameters is a
 * different matter — `a.length === b.length` is
 * the length check, which is deliberate — so only
 * the bare identifiers count.
 */
function comparesParametersDirectly(fn: ts.FunctionLikeDeclaration): boolean {
  const parameters = new Set(
    fn.parameters
      .map((parameter) => parameter.name)
      .filter((name) => ts.isIdentifier(name))
      .map((name) => name.text),
  );

  const isParameter = (node: ts.Expression): boolean =>
    ts.isIdentifier(node) && parameters.has(node.text);

  return within(fn).some((node) => {
    if (!ts.isBinaryExpression(node)) return false;

    const operator = node.operatorToken.kind;
    const strict =
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken;

    return strict && isParameter(node.left) && isParameter(node.right);
  });
}

/**
 * What is wrong with a secret comparison, if
 * anything.
 *
 * Each of these is a way of ending up with a
 * comparison that answers every test correctly and
 * leaks how much of a guess was right: the import
 * gone, the call gone, or the call still there
 * with the answer given away above it.
 */
export function constantTimeProblems(
  source: string,
  functionName: string,
): string[] {
  const file = ts.createSourceFile(
    'compare.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const problems: string[] = [];

  if (!importsSafeEqual(file)) {
    problems.push(`does not import ${SAFE_EQUAL} from ${CRYPTO}`);
  }

  const fn = functionNamed(file, functionName);
  if (fn === undefined) {
    problems.push(`declares no ${functionName}()`);
    return problems;
  }

  if (!callsSafeEqual(fn)) {
    problems.push(`${functionName}() does not call ${SAFE_EQUAL}`);
  }
  if (comparesParametersDirectly(fn)) {
    problems.push(`${functionName}() compares its two parameters directly`);
  }

  return problems;
}
