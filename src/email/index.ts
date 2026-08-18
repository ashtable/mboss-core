/**
 * The mBoss email render layer: the card both
 * emails arrive in, the small Markdown dialect a
 * broadcast body is written in, and the two
 * templates themselves.
 *
 * The worker sends these messages and the admin
 * console previews them as they are composed, so
 * one implementation lives here rather than two
 * that drift. Sending is not part of it — that
 * needs a provider key and a network, and stays
 * in the worker.
 *
 * This directory imports nothing at all, not even
 * a `node:` builtin, and a test enforces it: the
 * preview renders in a browser, where a builtin
 * would break the bundle.
 */
export { escapeHtml } from './html.js';
export { listUnsubscribeHeaders } from './list-unsubscribe.js';
export { renderMarkdown } from './markdown.js';
export { renderShell } from './shell.js';
export { renderConfirmationEmail } from './confirmation.js';
export { renderBroadcastEmail } from './broadcast.js';

export type { EmailMessage } from './message.js';
export type { BroadcastLinks } from './broadcast.js';
