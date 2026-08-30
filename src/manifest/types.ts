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
 */
export const LibManifestSchema = z.object({
  scannedAt: z.iso.datetime(),
  sourceHash: z.string(),
  functions: z.array(LibFunctionSchema),
  types: z.array(z.string()),
  typeSources: z.record(z.string(), z.string()),
  errors: z.array(ManifestErrorSchema),
});

export type LibFunction = z.infer<typeof LibFunctionSchema>;
export type ManifestError = z.infer<typeof ManifestErrorSchema>;
export type LibManifest = z.infer<typeof LibManifestSchema>;
