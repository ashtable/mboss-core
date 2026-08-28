import type { LayoutOptions } from 'elkjs';

/**
 * The one option set every layout runs under.
 *
 * These are pinned rather than tuned per call:
 * layout is recomputed on every render, and the
 * same document rendered twice has to land in the
 * same place, so there is no caller-supplied knob
 * that could make two renders disagree.
 *
 * Every value is a string. ELK parses its own
 * option values out of strings, and elkjs types
 * the option map as string-valued — a boolean or a
 * number happens to be coerced, but only the
 * string form actually type-checks.
 *
 * Changing anything here moves every coordinate
 * and means re-blessing the layout goldens.
 */
export const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',

  // Workflows read top to bottom: a trigger at the
  // top, sinks at the bottom.
  'elk.direction': 'DOWN',

  // Break ties from the canonical node and edge
  // order the graph is built in, rather than from
  // whatever order the heuristics happen to reach.
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',

  // Loop-closing edges are handed to ELK reversed,
  // and this is what tells it to route them back
  // against the flow instead of dragging their
  // endpoints into new layers.
  'elk.layered.feedbackEdges': 'true',

  // ELK seeds itself from the system clock when the
  // seed is 0, which would make a run depend on
  // when it happened. Any fixed nonzero value
  // removes the clock; this one is not special.
  'elk.randomSeed': '1',

  // Enough gap for an edge label to sit between two
  // nodes without touching either.
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
} as const satisfies LayoutOptions;
