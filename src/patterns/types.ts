import { z } from 'zod';

import type { ApplyError } from '../apply/index.js';
import { NodeKindSchema, type WorkflowIR } from '../ir/index.js';

/**
 * What a pattern is, and what using one can come
 * to.
 *
 * A pattern is a whole workflow somebody
 * instantiates — a document and the handlers it
 * names — rather than a file the scaffold copies,
 * which is what `scaffold/templates/` already
 * means. The two are different enough that sharing
 * a word for them would make every sentence about
 * either one ambiguous.
 */

/**
 * The shelves the gallery groups patterns onto.
 *
 * A closed set rather than free text: a person
 * scanning the gallery is looking for the shape of
 * their problem, and three shelves they can hold
 * in their head beats twenty tags they cannot.
 */
export const PatternGroupSchema = z.enum(['ai', 'backend', 'devops']);

/**
 * What the gallery knows about a pattern without
 * opening it.
 *
 * This is the card: one sentence, a shelf, a few
 * words to search on, and the four block kinds
 * drawn as a run of glyphs. It is authored beside
 * the document rather than derived from it because
 * the summary and the tags are editorial — but the
 * glyphs are not, and a test holds them to the
 * document.
 */
export const PatternMetaSchema = z.object({
  summary: z.string().min(1),
  group: PatternGroupSchema,
  tags: z.array(z.string().min(1)).min(1).max(5),
  /**
   * Exactly four kinds, in order of first
   * occurrence. Four because the card has room for
   * four, and in that order because the run of
   * glyphs is meant to read as the beginning of
   * the workflow rather than as a legend.
   */
  glyphs: z.array(NodeKindSchema).length(4),
  /**
   * The one pattern to open when showing somebody
   * what mBoss is. Absent everywhere else, so that
   * "there is a flagship" stays a fact rather than
   * a preference.
   */
  demo: z.literal(true).optional(),
});

export type PatternGroup = z.infer<typeof PatternGroupSchema>;

export type PatternMeta = z.infer<typeof PatternMetaSchema>;

/**
 * One pattern, as the library holds it.
 *
 * `name` is the directory it lives in and the
 * default workflow name it is offered under;
 * `title` is the document's, so there is one copy
 * rather than two that can disagree. The document
 * is a first revision with no positions on it —
 * where the blocks sit is the first thing its new
 * owner decides.
 *
 * `lib` carries the handler files as text, with
 * project-relative paths (`lib/getPurchase.ts`),
 * because they are copied into a project rather
 * than imported from here.
 */
export type WorkflowPattern = {
  name: string;
  title: string;
  meta: PatternMeta;
  document: WorkflowIR;
  lib: readonly { path: string; contents: string }[];
};

/**
 * What using a pattern came to.
 *
 * A new type rather than three more `ApplyError`
 * codes: `apply/errors.ts` describes what can go
 * wrong editing a document, and none of these is
 * an edit. A pattern is refused because the
 * project already has something of that name, and
 * the caller's answer is to pick another one
 * rather than to re-read and retry.
 *
 * Every path here is an absolute path on disk, the
 * way `workflow_create` already reports the file
 * it wrote.
 *
 * `written` is on the failing case too, and is the
 * one way a refusal leaves a trace: the handlers
 * are written before the document, so an apply
 * that refuses leaves them behind, and the caller
 * has to be able to say which files those were.
 */
export type UsePatternOutcome =
  | { ok: true; path: string; written: string[] }
  | { ok: false; code: 'WORKFLOW_EXISTS'; name: string }
  | { ok: false; code: 'LIB_FILE_EXISTS'; path: string }
  | {
      ok: false;
      code: 'APPLY_FAILED';
      error: ApplyError;
      written: string[];
    };
