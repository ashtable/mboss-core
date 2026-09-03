import { z } from 'zod';

/**
 * The building blocks every part of the Workflow
 * IR is made of: the identifier formats, the
 * three shared node modifiers, and the edge.
 *
 * Nothing here knows about node kinds. The
 * catalog builds on this file, so the dependency
 * runs one way and neither file has to be loaded
 * before the other.
 */

/**
 * A workflow's file name and its DBOS workflow
 * name are the same slug, so it has to survive
 * both: lowercase, no spaces, short enough for a
 * path.
 */
export const WorkflowNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);

/**
 * Node ids are readable slugs (`parse_request`),
 * not opaque uuids — they name generated
 * functions and appear in diagnostics, so a
 * person has to be able to read them.
 */
export const NodeIdSchema = WorkflowNameSchema;

/**
 * The name of a type exported by the project's
 * code-behind. Validation resolves it against the
 * scanned manifest; the format is only what a
 * TypeScript type name can be.
 */
export const TypeNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/);

/**
 * A test on one value pulled out of a payload by
 * dot-path. `value` is absent for `exists` and
 * `nonempty`, which have nothing to compare
 * against.
 */
export const PredicateSchema = z.object({
  path: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists', 'nonempty']),
  value: z.json().optional(),
});

/**
 * A step's retry policy. Every field has a
 * default, so a node that says `"retry": {}` means
 * "retry, the usual way" rather than "retry, with
 * nothing configured".
 */
export const RetrySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  intervalSeconds: z.number().positive().default(1),
  backoffRate: z.number().min(1).default(2),
});

/**
 * Fan-out over an array in the node's input. This
 * is a modifier on an ordinary step rather than a
 * node kind of its own: the canvas draws one
 * durable step running N times, not a different
 * shape of block.
 */
export const FanOutSchema = z.object({
  itemsPath: z.string(),
  concurrency: z.number().int().min(1).max(16).default(4),
});

/**
 * Which named export in the project's code-behind
 * a node runs. A node may carry no handler at
 * all — the canvas creates blocks before the code
 * behind them exists.
 */
export const HandlerRefSchema = z.object({ export: z.string() });

/**
 * Where a node sits on the canvas, in whole
 * pixels. A stored `412.33333` would diff on
 * every drag and lay out differently on machines
 * that round the last bit differently, so the
 * canvas rounds before it writes.
 */
export const PositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

/**
 * Everything every node has, whatever its kind.
 * The catalog extends this with the `kind`
 * literal and the matching `config`, which is why
 * `kind` is not here.
 */
export const NodeBase = z.object({
  id: NodeIdSchema,
  title: z.string(),
  in: TypeNameSchema.optional(),
  out: TypeNameSchema.optional(),
  guard: PredicateSchema.optional(),
  forEach: FanOutSchema.optional(),
  retry: RetrySchema.optional(),
  handler: HandlerRefSchema.optional(),
  position: PositionSchema.optional(),
});

/**
 * A wire between two node ports.
 *
 * `from.port` defaults to `out` because only
 * branches and approvals have more than one, and
 * `back` defaults to false because a loop-closing
 * edge is the exception — layout and the cycle
 * rules both treat it specially, so it has to be
 * declared rather than inferred.
 */
export const EdgeSchema = z.object({
  id: z.string().regex(/^e\d+$/),
  from: z.object({ node: NodeIdSchema, port: z.string().default('out') }),
  to: z.object({ node: NodeIdSchema }),
  type: TypeNameSchema.optional(),
  back: z.boolean().default(false),
});

export type Predicate = z.infer<typeof PredicateSchema>;
export type Retry = z.infer<typeof RetrySchema>;
export type FanOut = z.infer<typeof FanOutSchema>;
export type HandlerRef = z.infer<typeof HandlerRefSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type WorkflowEdge = z.infer<typeof EdgeSchema>;
