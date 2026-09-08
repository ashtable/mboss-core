import { ts } from 'ts-morph';

/**
 * What has to be true of a generated workflow
 * file, checked by reading the file back.
 *
 * Every rule here guards against a failure that
 * nothing else in the chain can see. A type-check
 * is happy with a clock read in a workflow body; a
 * golden is happy with two steps recording the
 * same name; both compile, both pass review, and
 * both fail days later on the first recovery,
 * where the cause is nowhere near the symptom.
 *
 * The parser is ts-morph's bundled compiler rather
 * than the `typescript` devDependency: this
 * directory is consumed as source by two other
 * repositories, and shipped code cannot reach for
 * a devDependency.
 */

/** One finding, with the line it is on. */
export type AuditProblem = { line: number; why: string };

/**
 * Why a link may not be minted in a workflow body.
 *
 * The generated code emits no minting call at all —
 * `sendNodeEmail` mints inside the step it is
 * called from — so this rule is what keeps that
 * true rather than merely intended.
 */
const MINTING =
  'minting a link stamps the clock into it, and a replay would mint a ' +
  'different one';

/**
 * Calls that make a workflow body irreproducible,
 * with what to say about each.
 *
 * The SDK's own `DBOS.now` and `DBOS.randomUUID`
 * are absent on purpose: they are checkpointed, so
 * a replay gets the value the first run got.
 */
const BANNED_CALLS: Record<string, string> = {
  'Date.now':
    'Date.now() reads the clock, and a replay would read a different one',
  'Math.random': 'Math.random() is a different number on every replay',
  randomUUID: 'randomUUID() is a different id on every replay',
  'crypto.randomUUID': 'randomUUID() is a different id on every replay',
  fetch: 'fetch() reaches the network outside a step, so it is never retried',
  setTimeout: 'setTimeout() does not survive a restart; a durable wait does',
  mintLink: MINTING,
  mintFormLink: MINTING,
  mintArtifactLink: MINTING,
};

/**
 * Calls whose first argument runs as a checkpoint
 * rather than as part of the workflow body.
 */
const STEP_CALLS = ['DBOS.runStep'];
const TRANSACTION_CALLS = ['appDb.runTransaction'];

/**
 * Calls that belong to the workflow itself and
 * throw from inside a checkpoint.
 *
 * A step is not a workflow: parking on a message,
 * publishing an event or starting another run from
 * inside one is an invalid transition, and the SDK
 * says so at run time rather than at compile time.
 */
const WORKFLOW_ONLY: Record<string, string> = {
  'DBOS.recv': 'DBOS.recv() parks the workflow and cannot run inside a step',
  'DBOS.send': 'DBOS.send() belongs to the workflow, not to a step',
  'DBOS.setEvent': 'DBOS.setEvent() belongs to the workflow, not to a step',
  'DBOS.sleep': 'DBOS.sleep() belongs to the workflow, not to a step',
  'DBOS.startWorkflow':
    'DBOS.startWorkflow() cannot start a run from inside a step',
};

/**
 * Everything that stops a run replaying to the
 * same place, plus the two placement rules that
 * fail the same way.
 */
export function determinismProblems(source: string): AuditProblem[] {
  return walkFor(source, true);
}

/**
 * The half of it that holds of hand-written runtime
 * code as well.
 *
 * A workflow body may not read the clock, mint or
 * roll a number; the code around it must — an
 * email's link carries an issued time, and
 * something has to supply it. What carries over is
 * placement: what only exists inside a transaction,
 * what may not run inside a step, and a fan-out
 * that drops the results of everything that had not
 * settled.
 */
export function placementProblems(source: string): AuditProblem[] {
  return walkFor(source, false);
}

function walkFor(source: string, reproducible: boolean): AuditProblem[] {
  const file = parse(source);
  const found: AuditProblem[] = [];

  const report = (node: ts.Node, why: string): void => {
    found.push({ line: lineOf(file, node), why });
  };

  const visit = (node: ts.Node, inStep: boolean, inTx: boolean): void => {
    const call = ts.isCallExpression(node) ? node : undefined;
    const callee = call ? text(file, call.expression) : undefined;

    if (callee === 'Promise.all') {
      report(
        node,
        'Promise.all drops the results of everything that had ' + 'not settled',
      );
    }

    if (
      reproducible &&
      !inStep &&
      callee !== undefined &&
      callee in BANNED_CALLS
    ) {
      report(node, BANNED_CALLS[callee] ?? '');
    }

    if (inStep && callee !== undefined && callee in WORKFLOW_ONLY) {
      report(node, WORKFLOW_ONLY[callee] ?? '');
    }

    if (
      reproducible &&
      !inStep &&
      ts.isNewExpression(node) &&
      text(file, node.expression) === 'Date'
    ) {
      if (!isConstantDate(node)) {
        report(
          node,
          'new Date() reads the clock, and a replay would read a ' +
            'different one',
        );
      }
    }

    if (
      !inTx &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'client'
    ) {
      report(node, 'the datasource client only exists inside a transaction');
    }

    if (call !== undefined && callee !== undefined) {
      const enteringStep = STEP_CALLS.includes(callee);
      const enteringTx = TRANSACTION_CALLS.includes(callee);

      if (enteringStep || enteringTx) {
        call.arguments.forEach((argument, index) => {
          visit(
            argument,
            index === 0 ? true : inStep,
            index === 0 ? inTx || enteringTx : inTx,
          );
        });
        visit(call.expression, inStep, inTx);
        return;
      }
    }

    ts.forEachChild(node, (child) => {
      visit(child, inStep, inTx);
    });
  };

  visit(file, false, false);

  return found.sort((a, b) => a.line - b.line);
}

/**
 * Whether a `new Date(…)` is a constant. A
 * schedule's bounds are, and they are the only
 * ones this compiler emits.
 */
function isConstantDate(node: ts.NewExpression): boolean {
  const [only] = node.arguments ?? [];

  return (
    node.arguments?.length === 1 &&
    only !== undefined &&
    ts.isStringLiteral(only)
  );
}

/**
 * What every emitted checkpoint has to say for
 * itself: an async arrow, a name, and a name no
 * other checkpoint in the file uses — plus, for a
 * step, an explicit retry decision.
 *
 * Transactions are held to the same account as
 * steps because DBOS records their names the same
 * way and compares them on the same replay. Only
 * the retry decision is a step's alone: a
 * transaction's config has no field to put one in.
 */
export function stepProblems(source: string): AuditProblem[] {
  const file = parse(source);
  const found: AuditProblem[] = [];
  const seen = new Map<string, number>();
  const checkpoints = [
    ...STEP_CALLS.flatMap((callee) =>
      callsTo(file, callee).map((call) => ({ call, retries: true })),
    ),
    ...TRANSACTION_CALLS.flatMap((callee) =>
      callsTo(file, callee).map((call) => ({ call, retries: false })),
    ),
  ].sort((a, b) => a.call.getStart(file) - b.call.getStart(file));

  for (const { call, retries } of checkpoints) {
    const line = lineOf(file, call);
    const [callback, config] = call.arguments;
    const options =
      config !== undefined && ts.isObjectLiteralExpression(config)
        ? config
        : undefined;
    const declared = options ? propertyText(file, options, 'name') : undefined;
    // Two steps in the same region differ only by
    // a counter, and that is not a collision. Two
    // that differ by nothing is.
    const name = declared === undefined ? undefined : normalise(declared);
    const label = name ?? '';

    if (name === undefined) {
      found.push({
        line,
        why:
          'a step with no name: DBOS records the name and compares it ' +
          'on replay',
      });
    }

    if (
      callback === undefined ||
      !ts.isArrowFunction(callback) ||
      !hasAsync(callback)
    ) {
      found.push({
        line,
        why: `the step ${label} is not run through an async arrow`,
      });
    }

    if (
      retries &&
      (options === undefined ||
        propertyText(file, options, 'retriesAllowed') === undefined)
    ) {
      found.push({
        line,
        why: `the step ${label} does not say whether retries are allowed`,
      });
    }

    if (name !== undefined) {
      const first = seen.get(name);

      if (first === undefined) seen.set(name, line);
      else {
        found.push({ line, why: `two steps both record the name ${name}` });
      }
    }
  }

  return found.sort((a, b) => a.line - b.line);
}

/**
 * Every row a compiled workflow would record, in
 * source order, read back off the file.
 *
 * The names come back as source text — `'search'`,
 * `` `search.r${round}` `` — rather than as the
 * strings a run would write. A step inside a loop
 * records a different name every round, and the
 * hole is the part that says which region varies;
 * flattening it away would leave a round
 * indistinguishable from a reminder.
 *
 * It exists because `stepProblems` walks the same
 * calls and reports problems rather than names.
 * Holding the trace grammar to what the emitter
 * actually writes needs the names, so this is a
 * second reader of the same file with a different
 * question.
 */
export function recordedNameLiterals(source: string): string[] {
  const file = parse(source);
  const registered = registeredNames(file);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      found.push(...rowsRecordedBy(file, node, registered));
    }
    ts.forEachChild(node, visit);
  };

  visit(file);

  return found;
}

/**
 * What each registration in the file binds, as the
 * name it registers under.
 *
 * Read once for the whole file because a run is
 * started off a binding: the call site names the
 * child as an identifier, and its registration is
 * the only thing that says what row starting it
 * writes.
 */
function registeredNames(file: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();

  for (const call of callsTo(file, 'DBOS.registerWorkflow')) {
    const declaration = call.parent;
    if (!ts.isVariableDeclaration(declaration)) continue;

    const [, config] = call.arguments;
    if (config === undefined || !ts.isObjectLiteralExpression(config)) continue;

    const name = propertyText(file, config, 'name');
    if (name === undefined) continue;

    names.set(declaration.name.getText(file), name);
  }

  return names;
}

/**
 * The rows one call writes.
 *
 * A checkpoint writes the name it declares.
 * `DBOS.recv` reserves two ids and writes under
 * both — its own row and the durable sleep that
 * times it out — which is why a file with no
 * `DBOS.sleep(` anywhere in it still records a
 * sleep.
 *
 * Starting a run writes two rows: the child's own
 * registered name, and the result the handle is
 * later awaited for. The call site spells the
 * child as a binding, so the first of those is
 * only nameable when the same file registers it —
 * which a compiled file always does, since the
 * only runs it starts are the children of its own
 * queue blocks.
 */
function rowsRecordedBy(
  file: ts.SourceFile,
  call: ts.CallExpression,
  registered: ReadonlyMap<string, string>,
): string[] {
  const callee = text(file, call.expression);

  if (STEP_CALLS.includes(callee) || TRANSACTION_CALLS.includes(callee)) {
    const [, config] = call.arguments;
    const options =
      config !== undefined && ts.isObjectLiteralExpression(config)
        ? config
        : undefined;
    const name = options ? propertyText(file, options, 'name') : undefined;

    return name === undefined ? [] : [name];
  }

  if (callee === 'DBOS.recv') return ['DBOS.recv', 'DBOS.sleep'];
  if (callee === 'DBOS.sleep') return ['DBOS.sleep'];

  // Matched on the last name rather than on the
  // whole callee: a run is started off `DBOS` or
  // off the workflow itself, and both spellings
  // record the same pair of rows.
  if (calleeName(call.expression) === 'startWorkflow') {
    const [target] = call.arguments;
    const child =
      target !== undefined && ts.isIdentifier(target)
        ? registered.get(target.text)
        : undefined;

    return child === undefined ? ['DBOS.getResult'] : [child, 'DBOS.getResult'];
  }

  return [];
}

/** What a call's callee is called, ignoring
 *  whatever it was reached through. */
function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isIdentifier(expression)) return expression.text;

  return undefined;
}

/**
 * The three lines every compiler-owned file opens
 * with.
 *
 * Compared as text rather than parsed: a comment
 * is not in the syntax tree, and the exact bytes
 * are the point — a header that drifted would make
 * "regeneration is clean" impossible to assert.
 */
export function headerProblems(
  source: string,
  workflowName: string,
): AuditProblem[] {
  const expected = [
    '// GENERATED BY MBOSS — DO NOT EDIT.',
    '// Regenerated from',
    `// .mboss/workflows/${workflowName}.workflow.json.`,
  ];
  const actual = source.split('\n').slice(0, 3);

  if (expected.every((line, index) => actual[index] === line)) return [];

  return [
    {
      line: 1,
      why:
        `the file does not open with the header for ${workflowName}; it ` +
        `opens with ${JSON.stringify(actual.join('\n'))}`,
    },
  ];
}

/**
 * The registration idiom, checked by parsing.
 *
 * A free function, registered once, at module
 * scope, under the snake_case name the ingress
 * route knows — and the undecorated function kept
 * to itself. Every one of those is a silent
 * failure if it slips: a class method breaks
 * idempotency for anything enqueuing by name, a
 * registration inside a function never runs, and a
 * second exported spelling is the one half the app
 * ends up calling.
 */
export function registrationProblems(
  source: string,
  workflowName: string,
): AuditProblem[] {
  const file = parse(source);
  const calls = callsTo(file, 'DBOS.registerWorkflow');
  const found: AuditProblem[] = [];

  if (calls.length === 0) {
    return [{ line: 1, why: 'the file registers no workflow' }];
  }

  if (calls.length > 1) {
    found.push({
      line: lineOf(file, calls[1] as ts.Node),
      why: 'the file registers more than one workflow',
    });
  }

  const call = calls[0] as ts.CallExpression;
  const line = lineOf(file, call);
  const [target, config] = call.arguments;
  const options =
    config !== undefined && ts.isObjectLiteralExpression(config)
      ? config
      : undefined;
  const name = options ? propertyText(file, options, 'name') : undefined;

  if (name === undefined) {
    found.push({
      line,
      why: 'the registration does not say what name to register under',
    });
  } else if (name !== `'${workflowName}'`) {
    found.push({
      line,
      why: `the workflow registers as ${name}, not '${workflowName}'`,
    });
  }

  const declaration = exportedDeclarationOf(call);

  if (declaration === undefined) {
    found.push({
      line,
      why: 'the registration does not run when the module is imported',
    });
  } else if (!isExported(declaration)) {
    found.push({ line, why: 'the registered workflow is not exported' });
  }

  const targetName =
    target !== undefined && ts.isIdentifier(target) ? target.text : undefined;

  if (targetName !== undefined && exportsName(file, targetName)) {
    found.push({
      line,
      why: `${targetName} is exported as well as the registered workflow`,
    });
  }

  return found.sort((a, b) => a.line - b.line);
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('w.ts', source, ts.ScriptTarget.ES2022, true);
}

function text(file: ts.SourceFile, node: ts.Node): string {
  return node.getText(file);
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

function callsTo(file: ts.SourceFile, callee: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && text(file, node.expression) === callee) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/** The source text of one property of an object
 *  literal, exactly as it is written. */
function propertyText(
  file: ts.SourceFile,
  options: ts.ObjectLiteralExpression,
  key: string,
): string | undefined {
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (property.name.getText(file) !== key) continue;

    return text(file, property.initializer);
  }

  return undefined;
}

function normalise(literal: string): string {
  return literal.replaceAll(/\$\{[^}]*\}/g, '*');
}

function hasAsync(node: ts.ArrowFunction): boolean {
  return (node.modifiers ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
  );
}

/**
 * The module-scope `export const x = <call>` a
 * registration sits in, when it sits in one.
 */
function exportedDeclarationOf(
  call: ts.CallExpression,
): ts.VariableStatement | undefined {
  const declaration = call.parent;
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) {
    return undefined;
  }

  const statement = declaration.parent.parent;
  if (!ts.isVariableStatement(statement)) return undefined;
  if (!ts.isSourceFile(statement.parent)) return undefined;

  return statement;
}

function isExported(statement: ts.VariableStatement): boolean {
  return (statement.modifiers ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function exportsName(file: ts.SourceFile, name: string): boolean {
  return file.statements.some((statement) => {
    const modifiers = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? [])
      : [];
    const exported = modifiers.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );

    if (!exported) return false;
    if (ts.isFunctionDeclaration(statement)) {
      return statement.name?.text === name;
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(
        (declaration) => declaration.name.getText(file) === name,
      );
    }

    return false;
  });
}
