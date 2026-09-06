import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  applySpec,
  mbossDirOf,
  workflowFile,
  writeFileAtomic,
  type ApplyError,
  type WorkflowSpec,
} from '../apply/index.js';
import { LIB_DIR } from '../app-contract/index.js';
import {
  WorkflowIRSchema,
  WorkflowNameSchema,
  type WorkflowIR,
} from '../ir/index.js';
import { loadOrScan } from '../manifest/index.js';

import {
  PatternMetaSchema,
  type UsePatternOutcome,
  type WorkflowPattern,
} from './types.js';

/**
 * The pattern gallery: whole workflows somebody
 * starts from, rather than an empty canvas.
 *
 * Each one ships a document and the handlers it
 * names, so pressing Use leaves a project that
 * draws, validates and compiles without anybody
 * writing a line first. That is the whole claim,
 * and `library.test.ts` is the run that makes it
 * one.
 *
 * Nothing here is read at import time. The
 * library is a directory of documents and source
 * files beside this module, read with
 * `readFileSync` off `import.meta.dirname` the way
 * the scaffold reads its runtime tree — an MCP
 * bundle that loaded the gallery to answer any
 * tool call at all would pay for it on every call.
 * A test enforces it.
 */

/**
 * The library on disk. Beside this module rather
 * than under `fixtures/`, because these files ship.
 */
const LIBRARY_DIR = join(import.meta.dirname, 'library');

/** The card authored beside each document. */
const META_FILE = 'pattern.json';

/**
 * Every pattern the gallery offers, in directory
 * order.
 *
 * Reads the whole library each call rather than
 * memoising it: a gallery is opened by hand, a few
 * small files is what it costs, and a cache would
 * have to be invalidated by something.
 */
export function listPatterns(): readonly WorkflowPattern[] {
  return readdirSync(LIBRARY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(patternIn);
}

/**
 * One pattern by name, or nothing.
 *
 * Found by walking the list rather than by joining
 * the name onto a path, so a name that came from
 * an agent or a URL can never read a directory the
 * library does not offer.
 */
export function patternNamed(name: string): WorkflowPattern | undefined {
  return listPatterns().find((pattern) => pattern.name === name);
}

/**
 * Writes a pattern into a project: its handlers
 * first, then its document.
 *
 * Ordered so that a refusal leaves the project as
 * it was found. The two existence checks are a
 * courtesy rather than the guard — they run
 * outside the apply engine's lock, so a document
 * can still appear between the check and the
 * write. The guard is `applySpec` itself, which is
 * told `baseRevision: null` — the claim "there is
 * no such workflow" — and answers a document that
 * turned up in the meantime with a conflict. That
 * arrives here as `APPLY_FAILED`, and it is the
 * one refusal that leaves the handler files
 * behind, which is why it names them.
 *
 * The handlers go first so that the first
 * generation after a person presses Use finds
 * every function the drawing calls for. Nothing is
 * generated here: codegen is all-or-nothing across
 * a project, and what this promises is the canvas
 * and the code-behind.
 */
export async function usePattern(
  projectDir: string,
  request: { pattern: WorkflowPattern; name: string },
): Promise<UsePatternOutcome> {
  const mbossDir = mbossDirOf(projectDir);

  // Both of these are answers `applySpec` gives on
  // its own, given here for a reason each. The
  // scan further down creates `.mboss/` to cache
  // its manifest in, so by the time the apply
  // engine looked, the directory it was going to
  // refuse for would be there. And a name no
  // workflow file could carry leaves `workflowFile`
  // below throwing, where every refusal here is
  // data.
  if (!existsSync(mbossDir)) {
    return refusedByApply({ code: 'NOT_AN_MBOSS_PROJECT', path: mbossDir });
  }
  if (!WorkflowNameSchema.safeParse(request.name).success) {
    return refusedByApply({ code: 'WORKFLOW_NOT_FOUND', name: request.name });
  }

  const documentPath = workflowFile(mbossDir, request.name);
  if (existsSync(documentPath)) {
    return { ok: false, code: 'WORKFLOW_EXISTS', name: request.name };
  }

  const files = request.pattern.lib.map((file) => ({
    path: join(projectDir, file.path),
    contents: file.contents,
  }));
  const taken = files.find((file) => existsSync(file.path));
  if (taken !== undefined) {
    return { ok: false, code: 'LIB_FILE_EXISTS', path: taken.path };
  }

  await mkdir(join(projectDir, LIB_DIR), { recursive: true });
  const written: string[] = [];
  for (const file of files) {
    await writeFileAtomic(file.path, file.contents);
    written.push(file.path);
  }

  const outcome = await applySpec(
    mbossDir,
    {
      name: request.name,
      spec: patternSpec(request.pattern.document),
      baseRevision: null,
    },
    { manifest: loadOrScan(projectDir) },
  );

  if (!outcome.ok) {
    return { ok: false, code: 'APPLY_FAILED', error: outcome.error, written };
  }

  return { ok: true, path: documentPath, written };
}

/**
 * A document as the spec an edit is allowed to
 * set: the envelope core owns — the schema, the
 * version, the revision, the name — left off.
 *
 * Without the strip, a spec built from a document
 * carries that document's revision back in,
 * freezing the counter so that every later base
 * revision matches and the conflict check stops
 * catching anything.
 */
export function patternSpec(document: WorkflowIR): WorkflowSpec {
  return {
    title: document.title,
    nodes: document.nodes,
    edges: document.edges,
  };
}

/**
 * The other thing the gallery offers: not a
 * pattern at all, but a canvas with a way in.
 *
 * An empty document is legal and `workflow_create`
 * still writes one. This is for somebody who chose
 * "start from blank" in a gallery of running
 * workflows and meant something they could send an
 * event to — so the topic is the workflow's own
 * name, which is the only thing known about it.
 */
export function blankSpec(name: string): WorkflowSpec {
  return {
    nodes: [
      {
        id: 'started',
        kind: 'trigger',
        title: 'Started',
        config: { mode: 'event', topic: name },
      },
    ],
    edges: [],
  };
}

/**
 * Reads one pattern directory.
 *
 * The document is parsed rather than trusted, the
 * way a project's own workflow file is: these
 * files ship as data, and a library that shipped a
 * malformed one should say so here rather than
 * somewhere downstream.
 */
function patternIn(name: string): WorkflowPattern {
  const dir = join(LIBRARY_DIR, name);
  const document = WorkflowIRSchema.parse(
    JSON.parse(readFileSync(join(dir, `${name}.workflow.json`), 'utf8')),
  );

  if (document.title === undefined) {
    throw new Error(`the ${name} pattern has no title`);
  }

  return {
    name,
    title: document.title,
    meta: PatternMetaSchema.parse(
      JSON.parse(readFileSync(join(dir, META_FILE), 'utf8')),
    ),
    document,
    lib: libOf(dir),
  };
}

/**
 * A pattern's code-behind, with the paths a
 * project will file it under. Flat and sorted:
 * flat because a project's `lib/` is, and sorted
 * so that "the first file that already exists"
 * means the same thing on every machine.
 */
function libOf(dir: string): readonly { path: string; contents: string }[] {
  const libDir = join(dir, LIB_DIR);

  return readdirSync(libDir)
    .filter((entry) => entry.endsWith('.ts'))
    .sort()
    .map((entry) => ({
      path: `${LIB_DIR}/${entry}`,
      contents: readFileSync(join(libDir, entry), 'utf8'),
    }));
}

/**
 * A refusal the apply engine would have made,
 * made earlier. Nothing has been written at this
 * point, which is the whole reason for hoisting
 * it.
 */
function refusedByApply(error: ApplyError): UsePatternOutcome {
  return { ok: false, code: 'APPLY_FAILED', error, written: [] };
}

export {
  PatternGroupSchema,
  PatternMetaSchema,
  type PatternGroup,
  type PatternMeta,
  type UsePatternOutcome,
  type WorkflowPattern,
} from './types.js';
