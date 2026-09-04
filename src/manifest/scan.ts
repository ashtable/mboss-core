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
  Project,
  ScriptTarget,
} from 'ts-morph';

import { readLibSources, sourceHashOf, toPosix } from './hash.js';
import { nonSerializableMembers } from './serializable.js';
import type {
  LibFunction,
  LibManifest,
  ManifestError,
  NonSerializable,
} from './types.js';

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
const NODE_TYPE_ROOT = dirname(
  dirname(createRequire(import.meta.url).resolve('@types/node/package.json')),
);

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
    ...(doc?.trim() ? { doc: oneLine(doc) } : {}),
  };
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
