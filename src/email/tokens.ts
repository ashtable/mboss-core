/**
 * The design's colours and font stacks, as
 * literal values. An email has no `<style>` block
 * driving custom properties and no `color-mix()`,
 * so every one of these is inlined on the element
 * that uses it.
 *
 * The divider is the alpha form rather than a hex
 * precomputed against white: the card sits on a
 * grey page, so a flattened colour would be wrong
 * everywhere but the card's own edge. Legacy
 * Outlook's rendering engine is the one place
 * that loses the alpha, and it degrades to a
 * slightly darker rule rather than to nothing.
 *
 * Web fonts do not load in most clients, so both
 * stacks fall through to `system-ui`. That is
 * accepted rather than chased. The family names
 * are single-quoted so they need no escaping
 * inside a double-quoted `style` attribute.
 */
export const NEUTRAL_100 = '#f5f5f8';
export const DIVIDER = 'rgba(29, 31, 32, 0.16)';
export const ACCENT = '#5980a6';
export const NEUTRAL_500 = '#98989b';
export const NEUTRAL_600 = '#7a7a7d';
export const NEUTRAL_700 = '#5d5d60';

export const HEADING_FONT = "'Barlow Condensed', system-ui, sans-serif";
export const BODY_FONT = "'Barlow', system-ui, sans-serif";
export const MONO_FONT = 'ui-monospace, Menlo, monospace';
