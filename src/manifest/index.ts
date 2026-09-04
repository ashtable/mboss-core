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
  ExternalCallSchema,
  LibFunctionSchema,
  ManifestErrorSchema,
  NonSerializableReasonSchema,
  NonSerializableSchema,
  LibManifestSchema,
} from './types.js';
export { sourceHashOf } from './hash.js';
export { scanLib } from './scan.js';
export { loadOrScan } from './cache.js';

export type {
  ExternalCall,
  LibFunction,
  ManifestError,
  NonSerializable,
  NonSerializableReason,
  LibManifest,
} from './types.js';
export type { LibSourceFile } from './hash.js';

// `nonSerializableMembers` is deliberately not
// here. It takes a ts-morph type, which only a
// scan with the project still open has, and
// re-exporting it would put ts-morph's types on
// the surface every consumer of this library sees.
