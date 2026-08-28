import type { NodeKind } from '../ir/catalog.js';

/**
 * The fixed geometry every node is drawn and laid
 * out with.
 *
 * Sizes come from this table and are never
 * measured. Measuring text would make the same
 * workflow lay out one way inside the extension's
 * webview and another way in Node, which is
 * exactly the drift that layout being a pure
 * function of the IR is meant to rule out.
 *
 * The canvas has to draw nodes at these sizes
 * rather than pick its own, or the boxes it paints
 * will not be the boxes the coordinates were
 * computed for.
 *
 * Every constant in this file feeds the blessed
 * layout goldens, so changing any one of them
 * moves every coordinate and means re-blessing
 * them.
 */

/**
 * One width for every kind, because nodes stack
 * into columns and a column of ragged widths reads
 * as noise rather than as structure.
 */
export const NODE_WIDTH = 240;

/**
 * Room for the title and the kind chip above the
 * first config row.
 */
export const NODE_BASE_HEIGHT = 56;

/**
 * One line of the node's config summary.
 */
export const CONFIG_ROW_HEIGHT = 22;

/**
 * How much of a title a node shows. Titles are
 * free text, so without a cap one long title would
 * be the only thing setting the width of every
 * node on the canvas.
 */
export const TITLE_MAX_CHARS = 32;

/**
 * How many lines of config summary each kind draws
 * under its title.
 *
 * The count is per kind rather than per node so
 * that editing a branch's cases or an email's
 * subject moves nothing on the canvas — a node
 * that changed height on every keystroke would
 * reflow the whole graph while the author typed.
 */
const CONFIG_ROWS: Record<NodeKind, number> = {
  trigger: 2, // how it fires, and on what
  step: 1, // the handler it runs
  transaction: 1, // the handler it runs
  apiCall: 2, // the service, and the handler
  branch: 2, // the cases, and the else port
  loop: 2, // the round bounds, and the body
  durableWait: 2, // what it waits for, and how long
  approval: 2, // who decides, and how long they have
  emailSend: 3, // recipient, subject, attachment
  codeStep: 1, // the handler it runs
};

/**
 * The box a node of this kind occupies. This is
 * the only size layout ever uses, so two runs on
 * the same IR start from the same boxes.
 */
export function nodeSize(kind: NodeKind): {
  width: number;
  height: number;
} {
  return {
    width: NODE_WIDTH,
    height: NODE_BASE_HEIGHT + CONFIG_ROWS[kind] * CONFIG_ROW_HEIGHT,
  };
}

/**
 * The title as a node shows it.
 *
 * It cuts on whole characters rather than on code
 * units, so a title ending in an emoji loses the
 * emoji instead of half of it.
 */
export function truncateTitle(title: string): string {
  const characters = [...title];
  if (characters.length <= TITLE_MAX_CHARS) return title;

  return `${characters.slice(0, TITLE_MAX_CHARS - 1).join('')}…`;
}
