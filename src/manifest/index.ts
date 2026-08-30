/**
 * The `/lib` manifest: what a project's code-behind
 * offers a workflow.
 *
 * The canvas draws its palette from it, validation
 * resolves a node's handler and declared types
 * against it, and the compiler emits imports from
 * it. Everything here is derived from the code on
 * disk — the manifest is never edited, only
 * rescanned.
 */
export {
  LibFunctionSchema,
  ManifestErrorSchema,
  LibManifestSchema,
} from './types.js';
export { sourceHashOf } from './hash.js';
export { scanLib } from './scan.js';
export { loadOrScan } from './cache.js';

export type { LibFunction, ManifestError, LibManifest } from './types.js';
export type { LibSourceFile } from './hash.js';
