/**
 * What generated code calls things.
 *
 * Three separate jobs live here because all three
 * have to agree with each other: the identifier a
 * workflow function is exported under, the local a
 * node's result is bound to, and the name a step
 * is recorded under. The last of those is not
 * cosmetic — DBOS compares the recorded name at
 * each function id when it replays a run, and a
 * name that moves turns every recovery into an
 * error days after the change that caused it.
 */

/**
 * `groom_booking` becomes `groomBooking`. Only the
 * identifier changes: the name a workflow
 * registers under stays the snake_case IR name,
 * because that is the spelling the ingress route
 * and anything enqueuing by name already knows.
 */
export function camelCase(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((word, index) =>
      index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join('');
}

/**
 * Every binding a generated workflow body holds,
 * so no two of them can be the same word.
 *
 * The reserved set starts with the imports, since
 * a local named after the handler it calls would
 * shadow it — the call would then be a recursive
 * reference to a `const` in its own initialiser,
 * which is a runtime error rather than a compile
 * one.
 */
export class LocalNames {
  readonly #taken: Set<string>;
  readonly #byNode = new Map<string, string>();

  constructor(reserved: readonly string[]) {
    this.#taken = new Set(reserved);
  }

  /** The local a node's result is bound to. */
  forNode(nodeId: string): string {
    const existing = this.#byNode.get(nodeId);
    if (existing !== undefined) return existing;

    const name = this.take(`${camelCase(nodeId)}Out`);
    this.#byNode.set(nodeId, name);

    return name;
  }

  /**
   * A temporary, under the name asked for when it
   * is free and a numbered one when it is not.
   */
  take(preferred: string): string {
    if (!this.#taken.has(preferred)) {
      this.#taken.add(preferred);
      return preferred;
    }

    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${preferred}${suffix}`;

      if (!this.#taken.has(candidate)) {
        this.#taken.add(candidate);
        return candidate;
      }
    }
  }
}

/**
 * One enclosing region of a step, as it appears in
 * the step's recorded name.
 *
 * Every variable named here is derived from
 * checkpointed control flow — a loop counter, a
 * chunk offset — and never from a clock or a
 * random value, which is what makes the name the
 * same on a replay as it was on the first run.
 */
export type StepSegment = { kind: 'round'; name: string } | { kind: 'item' };

/**
 * The source text of a step's `name` option: a
 * plain string when the step runs once, a template
 * literal when it runs inside a region that
 * numbers it.
 */
export function stepNameLiteral(
  nodeId: string,
  segments: readonly StepSegment[],
): string {
  if (segments.length === 0) return `'${nodeId}'`;

  const tail = segments.map(segmentText).join('');

  return `\`${nodeId}${tail}\``;
}

function segmentText(segment: StepSegment): string {
  switch (segment.kind) {
    case 'round':
      return `.r\${${segment.name}}`;

    case 'item':
      return '[${offset + index}]';
  }
}
