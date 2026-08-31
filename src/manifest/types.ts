import { z } from 'zod';

/**
 * What a scan of a project's code-behind produced:
 * the palette the canvas offers, the names
 * validation resolves a node's handler and types
 * against, and the type errors found on the way.
 *
 * These are schemas and not bare types because the
 * manifest is cached to disk and read back on the
 * next run. `.mboss/manifest.json` is derived,
 * gitignored and hand-editable, so nothing may
 * assume it still has the shape the version that
 * wrote it used.
 */

/**
 * One exported function a node can name as its
 * handler.
 *
 * `returnType` is the value the function produces
 * with `Promise` already unwrapped, so a node's
 * declared `out` compares against it directly
 * whether the handler is async or not.
 */
export const LibFunctionSchema = z.object({
  export: z.string(),
  file: z.string(),
  params: z.array(z.object({ name: z.string(), type: z.string() })),
  returnType: z.string(),
  doc: z.string().optional(),
});

/**
 * A type error in the code-behind, carried rather
 * than thrown. Code mid-edit is the normal case,
 * not the exceptional one — the canvas still has
 * to draw, and the error belongs on screen next to
 * the block it came from.
 */
export const ManifestErrorSchema = z.object({
  file: z.string(),
  message: z.string(),
});

/**
 * Why a type cannot travel between blocks.
 *
 * Values move through the workflow database on
 * their way from one block to the next, so
 * anything that is behaviour rather than data —
 * a function, a class with methods — or a live
 * resource — a buffer, a stream, an open
 * connection — arrives at the far end as
 * something else, or does not arrive at all.
 */
export const NonSerializableReasonSchema = z.enum([
  'function',
  'class',
  'buffer',
  'stream',
  'handle',
]);

/**
 * One place a scanned type cannot survive the trip
 * between blocks.
 *
 * `path` is the dot-path to the member at fault
 * and is empty for the type itself, which is what
 * a class instance with methods is.
 */
export const NonSerializableSchema = z.object({
  type: z.string(),
  path: z.string(),
  reason: NonSerializableReasonSchema,
});

/**
 * The scan result as a whole.
 *
 * `types` is the flat list of names the canvas
 * palette offers as edge types. `typeSources` says
 * which file each of those names came from,
 * because the compiler has to emit
 * `import type { Booking } from './lib/types.js'`
 * and a bare list of names cannot produce an
 * import path.
 *
 * `sourceHash` is the cache key: it covers exactly
 * the files this scan read, so a rescan is skipped
 * when and only when nothing the scan looked at
 * changed.
 *
 * `nonSerializable` is structure rather than a
 * name, and it is here because this is the only
 * moment structure exists: the scan holds the
 * parsed code, and everything downstream reads
 * this file back out of JSON.
 */
export const LibManifestSchema = z.object({
  scannedAt: z.iso.datetime(),
  sourceHash: z.string(),
  functions: z.array(LibFunctionSchema),
  types: z.array(z.string()),
  typeSources: z.record(z.string(), z.string()),
  nonSerializable: z.array(NonSerializableSchema),
  errors: z.array(ManifestErrorSchema),
});

export type LibFunction = z.infer<typeof LibFunctionSchema>;
export type ManifestError = z.infer<typeof ManifestErrorSchema>;
export type NonSerializableReason = z.infer<typeof NonSerializableReasonSchema>;
export type NonSerializable = z.infer<typeof NonSerializableSchema>;
export type LibManifest = z.infer<typeof LibManifestSchema>;
