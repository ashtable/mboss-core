import { libSpecifier, RUNTIME } from '../app-contract/index.js';
import type { LibManifest } from '../manifest/index.js';

import { UnsupportedIR } from './unsupported.js';

/**
 * The import section of a generated workflow.
 *
 * The emitters ask for bindings one at a time, as
 * they discover they need them, and this collects
 * them into statements. Doing it the other way —
 * each emitter writing its own import line —
 * produces duplicate statements for one file and
 * an order that follows the shape of the workflow
 * rather than a rule.
 */

/** The width the emitted file is formatted to. */
const CODE_COLUMNS = 80;

/** One binding the generated file needs. */
export type ImportEntry = {
  specifier: string;
  name: string;
  /** The name the file calls it by, when the
   *  export's own name is already spoken for. */
  alias?: string;
  /** Type-only. `verbatimModuleSyntax` rejects a
   *  statement mixing the two. */
  type: boolean;
};

/** A module of the runtime a generated file may reach. */
type RuntimeModule = keyof typeof RUNTIME;

/** One of the names that module offers. */
type RuntimeExport<M extends RuntimeModule> =
  (typeof RUNTIME)[M]['exports'][number];

/**
 * Where a runtime binding comes from.
 *
 * The specifier and the type-ness are the table's
 * to know, and the name is checked against what
 * the table says the module offers — so a rename
 * on the runtime side, made without the table,
 * stops the compiler here rather than inside a
 * generated file whose author is a program.
 */
export function runtimeImport<M extends RuntimeModule>(
  module: M,
  name: RuntimeExport<M>,
): ImportEntry {
  const entry = RUNTIME[module];

  return { specifier: entry.specifier, name, type: entry.type };
}

/**
 * Where a declared type name comes from.
 *
 * The manifest carries `typeSources` for exactly
 * this: a bare list of type names cannot produce
 * an import path.
 */
export function libTypeImport(
  manifest: LibManifest,
  typeName: string,
): ImportEntry {
  const file = manifest.typeSources[typeName];

  if (file === undefined) {
    throw new UnsupportedIR(
      `the code-behind exports no type called \`${typeName}\`, so there ` +
        `is no file to import it from.`,
    );
  }

  return { specifier: libSpecifier(file), name: typeName, type: true };
}

/** Where a handler comes from. */
export function libValueImport(
  manifest: LibManifest,
  exportName: string,
): ImportEntry {
  const fn = manifest.functions.find((each) => each.export === exportName);

  if (fn === undefined) {
    throw new UnsupportedIR(
      `the code-behind exports no function called \`${exportName}\`.`,
    );
  }

  return { specifier: libSpecifier(fn.file), name: exportName, type: false };
}

/**
 * Every statement, in one block ending with a
 * newline.
 *
 * Node builtins, then packages, then relative
 * paths, one blank line between groups and
 * alphabetical inside each. The order is a rule
 * rather than a preference because a generated
 * file is compared against the last one byte for
 * byte, and imports discovered in walk order would
 * move whenever a block did.
 */
export function importBlock(entries: readonly ImportEntry[]): string {
  const groups = [
    statementsFor(entries.filter((entry) => group(entry) === 0)),
    statementsFor(entries.filter((entry) => group(entry) === 1)),
    statementsFor(entries.filter((entry) => group(entry) === 2)),
  ].filter((lines) => lines.length > 0);

  if (groups.length === 0) return '';

  return `${groups.map((lines) => lines.join('\n')).join('\n\n')}\n`;
}

/**
 * How one binding is written: its own name, or
 * `<export> as <name>` where the file already has
 * something else called that.
 */
function bindingText(entry: ImportEntry): string {
  if (entry.alias === undefined || entry.alias === entry.name) {
    return entry.name;
  }

  return `${entry.name} as ${entry.alias}`;
}

/** Builtins first, packages next, relative last. */
function group(entry: ImportEntry): 0 | 1 | 2 {
  if (entry.specifier.startsWith('node:')) return 0;
  if (entry.specifier.startsWith('.')) return 2;

  return 1;
}

/**
 * One statement per specifier per kind. The value
 * import of a file comes before its type import,
 * so a reader meets the thing before the shape of
 * it.
 */
function statementsFor(entries: readonly ImportEntry[]): string[] {
  const byStatement = new Map<string, Set<string>>();

  for (const entry of entries) {
    const key = `${entry.specifier} ${entry.type ? '1' : '0'}`;
    const names = byStatement.get(key) ?? new Set<string>();

    names.add(bindingText(entry));
    byStatement.set(key, names);
  }

  return [...byStatement.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, names]) => {
      const [specifier = '', kind] = key.split(' ');
      const keyword = kind === '1' ? 'import type' : 'import';
      const sorted = [...names].sort();
      const one = `${keyword} { ${sorted.join(', ')} } from '${specifier}';`;

      if ([...one].length <= CODE_COLUMNS) return one;

      // One binding per line, which is what
      // prettier does with a statement this wide.
      return [
        `${keyword} {`,
        ...sorted.map((name) => `  ${name},`),
        `} from '${specifier}';`,
      ].join('\n');
    });
}
