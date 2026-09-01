/**
 * The numbers the compiler and the generated
 * runtime both have to know.
 *
 * The runtime cannot import this file — a project
 * carries `src/app/**` and nothing above it — so
 * it declares its own copy and a conformance test
 * in the scaffold holds the two together. That is
 * the arrangement the runtime import table uses,
 * and for the same reason: two numbers that
 * disagree are how a compiler comes to emit a
 * lifetime the runtime silently refuses.
 */

/**
 * The longest a form or approval link lasts,
 * whatever the wait it opens is configured for. A
 * credential sitting in an inbox for a year, with
 * nothing that can revoke it, is a different
 * proposition from one that expires while the
 * person is still likely to act on it.
 *
 * The compiler refuses a wait that would outlive
 * it, so the person's only way in never dies while
 * the run is still waiting for them.
 */
export const FORM_LINK_MAX_SECONDS = 2592000;
