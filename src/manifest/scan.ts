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
import type { LibFunction, LibManifest, ManifestError } from './types.js';

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
    // pointed at has configured, and an empty
    // `types` keeps whatever @types packages
    // happen to be installed out of the result.
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: ScriptTarget.ES2023,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
  });

  const scanned = sources.map((source) =>
    project.addSourceFileAtPath(join(projectDir, source.path)),
  );

  const functions: LibFunction[] = [];
  const typeSources = new Map<string, string>();

  for (const file of scanned) {
    const rel = relativeTo(projectDir, file);

    for (const declaration of file.getFunctions()) {
      const entry = handlerOf(declaration, rel);
      if (entry) functions.push(entry);
    }

    for (const declaration of [
      ...file.getInterfaces(),
      ...file.getTypeAliases(),
    ]) {
      if (declaration.isExported()) typeSources.set(declaration.getName(), rel);
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    sourceHash: sourceHashOf(sources),
    functions,
    types: [...typeSources.keys()].sort(),
    typeSources: Object.fromEntries([...typeSources].sort()),
    errors: errorsOf(project.getPreEmitDiagnostics(), projectDir),
  };
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

  // An overload signature repeats a name the
  // implementation already carries; taking both
  // would offer the same block twice.
  if (!name || !declaration.isExported() || declaration.isOverload()) {
    return undefined;
  }

  const doc = declaration.getJsDocs().at(-1)?.getDescription();

  return {
    export: name,
    file,
    params: declaration.getParameters().map((parameter) => ({
      name: parameter.getName(),
      type:
        parameter.getTypeNode()?.getText() ??
        parameter.getType().getText(parameter),
    })),
    returnType: returnTypeOf(declaration),
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
 * validation compares that against this.
 */
function returnTypeOf(declaration: FunctionDeclaration): string {
  const returned = declaration.getReturnType();

  return (promisedValueOf(returned) ?? returned).getText(declaration);
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
