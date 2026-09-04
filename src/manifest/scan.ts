import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

import type {
  Diagnostic,
  DiagnosticMessageChain,
  FunctionDeclaration,
  SourceFile,
  Type,
} from 'ts-morph';
import {
  DiagnosticCategory,
  ModuleKind,
  ModuleResolutionKind,
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
} from 'ts-morph';

import { readLibSources, sourceHashOf, toPosix } from './hash.js';
import { nonSerializableMembers } from './serializable.js';
import type {
  ExternalCall,
  LibFunction,
  LibManifest,
  ManifestError,
  NonSerializable,
} from './types.js';

/**
 * Node's own declarations, and no other package's.
 *
 * The type root below is the `@types` directory,
 * which holds whatever else this library happens
 * to depend on — and a package like
 * `@types/express` writes `declare module "http"`
 * of its own. Asking what Node declares means
 * asking about this directory, not that one.
 *
 * Posix-separated, because a path read back off a
 * parsed file always is; without that the test
 * against it silently never matches on Windows and
 * every call goes unseen there.
 */
const NODE_TYPES = toPosix(
  dirname(createRequire(import.meta.url).resolve('@types/node/package.json')),
);

/**
 * Where Node's global declarations are read from.
 *
 * Handlers are the code that calls services, and a
 * service credential comes out of `process.env` —
 * so without these, the ordinary handler scans as a
 * type error the project's own `tsc` never reports,
 * and whoever reads the manifest goes off to fix
 * working code.
 *
 * They are taken from this library rather than
 * found by walking up from wherever the process
 * happens to be running: the scan has to mean the
 * same thing on every machine, including in a
 * project whose dependencies are not installed yet.
 */
const NODE_TYPE_ROOT = dirname(NODE_TYPES);

/**
 * Everything `node:dns` asks a resolver for.
 * Written out rather than matched by prefix,
 * because a closed list is the whole point of the
 * table below.
 */
const DNS_QUERIES: readonly string[] = [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTlsa',
  'resolveTxt',
  'reverse',
];

/**
 * What Node offers for opening a connection to
 * another machine, module by module.
 *
 * Modules are named as the type checker names
 * them, which is the specifier without its `node:`
 * prefix — so one entry covers both spellings of
 * the import, and a list whose every member had to
 * be written twice cannot fall out of step with
 * itself.
 *
 * Functions are named one at a time rather than a
 * module being taken whole, because a networking
 * module is mostly not networking:
 * `tls.checkServerIdentity` compares a certificate
 * to a hostname, `dns.getServers` reads this
 * machine's own configuration, `net.isIP` tests a
 * string, and `process.stdout` is a `net.Socket`,
 * so printing a line resolves into `node:net` too.
 * Any of those is a reasonable thing to do before
 * writing a row, refusing one is a fault a person
 * can neither explain nor override, and no list of
 * exceptions to a module-wide sweep stays complete
 * as Node adds to these modules. What dials out,
 * by contrast, has not changed in years.
 *
 * `createServer` and its neighbours are absent for
 * a different reason: a server waits to be called
 * rather than calling.
 *
 * `fs` and `child_process` are absent as modules.
 * They leave the process too, but reading a
 * template or writing a temp file is not a call to
 * a service, and the sentence this produces would
 * be wrong about them — which is not something a
 * person can argue with.
 */
const NETWORK_CALLS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['http', new Set(['get', 'request'])],
  ['https', new Set(['get', 'request'])],
  ['http2', new Set(['connect'])],
  ['net', new Set(['connect', 'createConnection'])],
  ['tls', new Set(['connect'])],
  ['dgram', new Set(['createSocket'])],
  ['dns', new Set(DNS_QUERIES)],
  ['dns/promises', new Set(DNS_QUERIES)],
]);

/**
 * The globals that are a call to another machine
 * by themselves. One, today — and matched by the
 * declaration it resolves to, so a local name a
 * person chose for their own reasons is not it.
 */
const NETWORK_GLOBALS: ReadonlySet<string> = new Set(['fetch']);

/**
 * Scans a project's code-behind into the manifest
 * the canvas, validation and the compiler read.
 *
 * It never throws on a type error. A project whose
 * `lib/` does not compile is the ordinary state
 * mid-edit, and the canvas has to keep drawing —
 * so a diagnostic becomes an entry in `errors`
 * next to whatever did scan cleanly.
 *
 * Only named function declarations become handlers.
 * A node's handler is compiled into an import of
 * that name, so anything without one — a default
 * export, an anonymous expression — could not be
 * imported by the generated workflow anyway.
 */
export function scanLib(libDir: string): LibManifest {
  const projectDir = dirname(libDir);
  const sources = readLibSources(libDir);

  const project = new Project({
    // No tsconfig is read: the scan must mean the
    // same thing whatever the project it is
    // pointed at has configured. Naming the one
    // type root keeps every other @types package
    // that happens to be installed out of the
    // result, while still giving handlers the Node
    // globals they are written against.
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: ScriptTarget.ES2023,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ['node'],
      typeRoots: [NODE_TYPE_ROOT],
    },
  });

  const scanned = sources.map((source) =>
    project.addSourceFileAtPath(join(projectDir, source.path)),
  );

  const functions: LibFunction[] = [];
  const typeSources = new Map<string, string>();
  const nonSerializable: NonSerializable[] = [];

  for (const file of scanned) {
    const rel = relativeTo(projectDir, file);

    for (const declaration of file.getFunctions()) {
      const entry = handlerOf(declaration, rel);
      if (entry) functions.push(entry);
    }

    // Classes are here beside interfaces and
    // aliases because a node may declare one as
    // its input or output, and because a class
    // instance is the one shape whose methods are
    // lost on the way between two blocks — a fault
    // nothing could report about a type the canvas
    // was never offered.
    for (const declaration of [
      ...file.getInterfaces(),
      ...file.getTypeAliases(),
      ...file.getClasses(),
    ]) {
      const name = declaration.getName();

      // A class exported as the default has no name
      // at the import site, so it is no more usable
      // as a declared type than a default-exported
      // function is as a handler.
      if (name === undefined || !declaration.isExported()) continue;

      typeSources.set(name, rel);
      nonSerializable.push(
        ...nonSerializableMembers(name, declaration.getType()),
      );
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    sourceHash: sourceHashOf(sources),
    functions,
    types: [...typeSources.keys()].sort(),
    typeSources: Object.fromEntries([...typeSources].sort()),
    nonSerializable: nonSerializable.sort(byTypeThenPath),
    errors: errorsOf(project.getPreEmitDiagnostics(), projectDir),
  };
}

/**
 * Findings sort by the type they are about and
 * then by where in it they are, so a manifest does
 * not change merely because two files were read in
 * a different order.
 */
function byTypeThenPath(a: NonSerializable, b: NonSerializable): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;

  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * One exported handler, or nothing when the
 * declaration is not one a workflow could import.
 */
function handlerOf(
  declaration: FunctionDeclaration,
  file: string,
): LibFunction | undefined {
  const name = declaration.getName();

  // A default export has a name here but not at
  // the import site, so offering it would compile
  // into a named import of something the module
  // does not name. An overload signature repeats a
  // name the implementation already carries;
  // taking both would offer the same block twice.
  if (!name || !declaration.isNamedExport() || declaration.isOverload()) {
    return undefined;
  }

  const doc = declaration.getJsDocs().at(-1)?.getDescription();
  const returned = returnedValueOf(declaration);
  const decision = decisionOf(returned);
  const externalCalls = externalCallsIn(declaration);

  return {
    export: name,
    file,
    params: declaration.getParameters().map((parameter) => ({
      name: parameter.getName(),
      type:
        parameter.getTypeNode()?.getText() ??
        parameter.getType().getText(parameter),
      // Written only where it is true: a `false`
      // on every ordinary parameter would be noise
      // in a file people open, and whoever reads
      // this treats a missing flag as a parameter
      // the call has to pass.
      ...(parameter.isOptional() ? { optional: true } : {}),
    })),
    returnType: returned.getText(declaration),
    ...(decision ? { decision } : {}),
    // Written only where there is one, for the
    // same reason `optional` is: an empty array on
    // every function would be noise in a file
    // people open, and it would say nothing a
    // missing key does not already say.
    ...(externalCalls.length > 0 ? { externalCalls } : {}),
    ...(doc?.trim() ? { doc: oneLine(doc) } : {}),
  };
}

/**
 * Every call the function makes that reaches
 * another system.
 *
 * A parameter's default runs when the argument is
 * left out, so it is read alongside the body and
 * before it, which is the order the two run in.
 *
 * Descendants and not just the top level: a call
 * inside a callback the handler hands to `map` runs
 * inside the transaction just the same. That cuts
 * both ways, and deliberately: a closure the body
 * only hands on runs somewhere else, and a branch
 * guarded by a constant `false` runs nowhere, and
 * both are counted. Whether a line runs is not
 * something reading one function can answer, the
 * line named is a real line of the handler either
 * way, and moving the work to a step is the right
 * repair for all three.
 *
 * Calls only, so constructing an agent or a URL is
 * not one — building a thing that could talk to a
 * machine is not talking to it.
 */
function externalCallsIn(declaration: FunctionDeclaration): ExternalCall[] {
  const found: ExternalCall[] = [];
  // Each parameter whole rather than its default
  // alone, because a default is the parameter's own
  // descendant and a walk does not visit the node
  // it starts from. Nothing else a parameter is
  // made of can hold a call.
  const scopes = [...declaration.getParameters(), declaration.getBody()];

  for (const scope of scopes) {
    if (scope === undefined) continue;

    for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = unwrapped(call.getExpression());
      const via = reachedSystemOf(callee);

      if (via === undefined) continue;

      found.push({
        callee: oneLine(callee.getText()),
        via,
        line: call.getStartLineNumber(),
      });
    }
  }

  return found;
}

/**
 * The callee with the wrappers that change nothing
 * about what is called taken off, so that
 * `(fetch)(url)` and `fetch!(url)` read as the call
 * they are.
 *
 * It can only ever arrive at the same declaration
 * underneath, so it cannot make this refuse
 * anything it would otherwise allow. It also leaves
 * the recorded name the one a person can search
 * their file for.
 */
function unwrapped(callee: Node): Node {
  let node = callee;

  while (
    Node.isParenthesizedExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node)
  ) {
    node = node.getExpression();
  }

  return node;
}

/**
 * Where the thing being called is declared, when
 * that is another system, and `undefined`
 * otherwise.
 *
 * The question is put to the declaration the
 * checker resolved to rather than to the import the
 * file happens to have written, because the two are
 * not the same thing: a name re-exported by a
 * module of the project's own resolves through to
 * what it re-exports, and a variable someone named
 * `fetch` resolves to itself. Nothing here is
 * decided from the text of a specifier or of an
 * identifier.
 *
 * Only a positive answer counts. A call that
 * resolves to a package, to the project's own code,
 * or to nothing at all is not reported — greying a
 * legitimate function out of the picker is a fault
 * a person can neither explain nor override, while
 * missing one only leaves the behaviour that is
 * there today.
 */
function reachedSystemOf(callee: Node): string | undefined {
  // A method called on whatever another call
  // returned is not itself the call that reached
  // out: `connect(url).close()` reaches out once,
  // in the `connect`. That inner call is a
  // descendant of this one and is recorded on its
  // own, under a name a person can search their
  // file for.
  if (!Node.isIdentifier(rootOf(callee))) return undefined;

  const symbol = callee.getSymbol();
  if (symbol === undefined) return undefined;

  const resolved = symbol.getAliasedSymbol() ?? symbol;
  const name = resolved.getName();

  for (const declaration of resolved.getDeclarations()) {
    if (!declaration.getSourceFile().getFilePath().startsWith(NODE_TYPES)) {
      continue;
    }

    // Node declares each of its modules as
    // `declare module "https"`, quotes and all,
    // and its globals inside `declare global`.
    const ambient = declaration
      .getFirstAncestorByKind(SyntaxKind.ModuleDeclaration)
      ?.getName();

    if (ambient === undefined) continue;

    const named = ambient.replace(/^["']|["']$/g, '');

    // By name and not by file, because the file is
    // about networking while much of what it
    // declares is not: a class inside `net` carries
    // `write`, and `process.stdout` is one of those
    // classes.
    if (NETWORK_CALLS.get(named)?.has(name) === true) return `node:${named}`;

    if (named === 'global' && NETWORK_GLOBALS.has(name)) return 'globalThis';
  }

  return undefined;
}

/**
 * What a callee is ultimately reached through:
 * `appDb` in `appDb.client.booking.create`, and the
 * inner call in `connect(url).close`.
 */
function rootOf(callee: Node): Node {
  let node = callee;
  let access = node.asKind(SyntaxKind.PropertyAccessExpression);

  while (access !== undefined) {
    node = access.getExpression();
    access = node.asKind(SyntaxKind.PropertyAccessExpression);
  }

  return node;
}

/**
 * The value a handler produces, with `Promise`
 * unwrapped.
 *
 * Whether a handler is async is the generated
 * workflow's business, not the graph's: a node
 * declares `out: "SlotGrid"` either way, and
 * validation compares that against the name this
 * type prints as.
 */
function returnedValueOf(declaration: FunctionDeclaration): Type {
  const returned = declaration.getReturnType();

  return promisedValueOf(returned) ?? returned;
}

/**
 * The values a handler decides between, or nothing
 * when it decides nothing.
 *
 * This reads the resolved type and not the text
 * beside it in `returnType`, which prints the type
 * the way the source wrote it: `Promise<Verdict>`
 * is recorded as `Verdict`, and no reading of that
 * name could tell an ordinary alias from a decision
 * a branch can be built out of.
 */
function decisionOf(returned: Type): (string | boolean)[] | undefined {
  if (returned.isBoolean()) return [true, false];

  const members = returned.isUnion() ? returned.getUnionTypes() : [];
  if (members.length === 0 || !members.every((one) => one.isStringLiteral())) {
    return undefined;
  }

  // Every member is a string literal by the guard
  // above; the cast through `String` is what
  // ts-morph's numeric and bigint literals cost.
  return members.map((one) => String(one.getLiteralValueOrThrow()));
}

function promisedValueOf(type: Type): Type | undefined {
  if (type.getSymbol()?.getName() !== 'Promise') return undefined;
  return type.getTypeArguments()[0];
}

/**
 * Type errors, flattened into one string each.
 *
 * A chained diagnostic is a tree of message parts;
 * the manifest is read by a canvas tooltip and by
 * an MCP resource, and neither can render a tree.
 */
function errorsOf(
  diagnostics: Diagnostic[],
  projectDir: string,
): ManifestError[] {
  return diagnostics
    .filter((entry) => entry.getCategory() === DiagnosticCategory.Error)
    .map((entry) => {
      const file = entry.getSourceFile();
      return {
        file: file ? relativeTo(projectDir, file) : '',
        message: flattenMessage(entry.getMessageText()),
      };
    });
}

function flattenMessage(message: string | DiagnosticMessageChain): string {
  if (typeof message === 'string') return message;

  return [message.getMessageText(), ...(message.getNext() ?? [])]
    .map(flattenMessage)
    .join(' ');
}

/**
 * Paths in the manifest are relative to the
 * project root and posix-separated, so the same
 * code-behind scans to the same manifest on any
 * machine.
 */
function relativeTo(projectDir: string, file: SourceFile): string {
  return toPosix(relative(projectDir, file.getFilePath()));
}

/**
 * A JSDoc summary hard-wrapped in the source is
 * still one sentence; the manifest feeds it to a
 * palette label, so the wrapping is dropped.
 */
function oneLine(doc: string): string {
  return doc.replace(/\s+/g, ' ').trim();
}
