import ts from 'typescript';

/**
 * What a module calls, in the order it calls it.
 *
 * A generated app's boot has an order that has to
 * hold and that nothing else can check. The
 * datasource's schema must exist before
 * `DBOS.launch()`, because launch initialises
 * every registered datasource before it dispatches
 * recovery; and the HTTP listener must come after
 * launch, because the ingress route calls
 * `DBOS.startWorkflow` and that throws until
 * launch resolves. A request arriving in the boot
 * window is the failure, and it is invisible to a
 * type-check, to a lint and to a golden.
 *
 * Reading calls rather than statements is what
 * makes this survive reformatting and the ordinary
 * `async function main()` wrapper: a call is
 * recorded wherever it is written.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */

/**
 * The name a call expression is written under, or
 * `undefined` when it is not a name at all.
 *
 * A qualified call keeps its last segment:
 * `PrismaDataSource.initializeDBOSSchema(x)` reads
 * as `initializeDBOSSchema`, which is what a
 * reader of the boot sequence is looking for.
 */
function calledName(node: ts.CallExpression): string | undefined {
  const target = node.expression;

  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;

  return undefined;
}

export function callNamesInOrder(source: string): string[] {
  const file = ts.createSourceFile(
    'boot.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calledName(node);
      if (name !== undefined) found.push(name);
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/**
 * What is wrong with a boot sequence, if anything.
 *
 * Three orderings, and each of them fails in a way
 * that looks like something else. A datasource
 * whose schema is created after launch is invisible
 * until a crash recovery replays a workflow against
 * a table that was not there. A listener opened
 * before launch resolves accepts exactly the
 * requests that arrive during a deploy, and each
 * one throws inside `DBOS.startWorkflow` rather
 * than anywhere a reader would look.
 */
export function bootProblems(source: string): string[] {
  const calls = callNamesInOrder(source);
  const schema = calls.indexOf('initializeDBOSSchema');
  const launch = calls.indexOf('launch');
  const listen = calls.indexOf('listen');
  const problems: string[] = [];

  if (schema === -1) problems.push('never creates the datasource schema');
  if (launch === -1) problems.push('never calls DBOS.launch()');
  if (listen === -1) problems.push('never listens');

  if (schema >= 0 && launch >= 0 && schema > launch) {
    problems.push('creates the datasource schema after DBOS.launch()');
  }
  if (listen >= 0 && launch >= 0 && listen < launch) {
    problems.push('listens before DBOS.launch() resolves');
  }

  return problems;
}
