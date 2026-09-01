import { WorkflowNameSchema } from '../ir/index.js';

/**
 * Where the three trees of a generated project sit
 * and how a file in one of them names a file in
 * another.
 *
 * The compiler writes `src/workflows/**` and the
 * scaffold writes `src/app/**`, and the emitted
 * workflow imports the runtime while the runtime
 * imports the registry back. Both sides read these
 * constants; neither imports the other. Two copies
 * of the same join, one in each, is exactly how
 * the two would come to disagree.
 */

/** Code-behind: the handlers a person writes. */
export const LIB_DIR = 'lib';

/** The runtime: the project's, and editable. */
export const APP_DIR = 'src/app';

/** Compiler-owned, and rewritten on every run. */
export const WORKFLOWS_DIR = 'src/workflows';

export const CONTRACT_FILE = `${APP_DIR}/contract.ts`;
export const REGISTRY_FILE = `${WORKFLOWS_DIR}/index.ts`;

/**
 * The file one workflow compiles to.
 *
 * The name is parsed on the way through, the way
 * every other path built from a workflow name is:
 * a name carrying a slash or a `..` would name a
 * file outside the directory the compiler is
 * allowed to write, and the compiler deletes
 * whatever it does not recognise there.
 */
export function workflowFileName(name: string): string {
  return `${WorkflowNameSchema.parse(name)}.workflow.ts`;
}

export function workflowFilePath(name: string): string {
  return `${WORKFLOWS_DIR}/${workflowFileName(name)}`;
}

/**
 * How a generated workflow imports a code-behind
 * file, given the project-relative path the
 * manifest carries for it.
 *
 * The manifest says `lib/types.ts` and the import
 * has to say `../../lib/types.js` — two
 * directories up out of `src/workflows`, and a
 * runtime extension rather than a source one.
 * Nothing else may re-derive that join, which is
 * why a one-line function has a name.
 */
export function libSpecifier(manifestFile: string): string {
  const posix = manifestFile.split('\\').join('/');

  return `../../${posix.replace(/\.ts$/, '.js')}`;
}

/** How the registry imports one compiled workflow. */
export function registrySpecifier(name: string): string {
  return `./${workflowFileName(name).replace(/\.ts$/, '.js')}`;
}
