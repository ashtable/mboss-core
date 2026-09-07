import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applySpec, manifestFile, workflowFile } from '../apply/index.js';
import { LIB_DIR } from '../app-contract/index.js';
import { LibManifestSchema } from '../manifest/index.js';
import {
  makeProject,
  removeProject,
  type TestProject,
} from '../test-support/project.js';

import { blankSpec, patternNamed, usePattern } from './index.js';
import type { WorkflowPattern } from './types.js';

/**
 * Using a pattern, against a real project on disk.
 *
 * What matters here is what a refusal leaves
 * behind. Every check below asks the filesystem
 * rather than the return value: the promise is
 * that a project which refused a pattern looks
 * exactly like a project that was never offered
 * one, and only the disk can say whether that
 * held.
 */

const HERO = 'refund_approval';

function hero(): WorkflowPattern {
  const pattern = patternNamed(HERO);
  if (pattern === undefined) throw new Error(`no ${HERO} pattern`);

  return pattern;
}

let project: TestProject;

beforeEach(async () => {
  project = await makeProject();
});

afterEach(async () => {
  await removeProject(project);
});

/** Everything under the project's `lib/`, or
 *  nothing when there is no such directory. */
async function libFiles(): Promise<string[]> {
  try {
    return (await readdir(join(project.projectDir, LIB_DIR))).sort();
  } catch {
    return [];
  }
}

describe('usePattern', () => {
  it('writes the pattern into a project that has room for it', async () => {
    const pattern = hero();
    const outcome = await usePattern(project.projectDir, {
      pattern,
      name: HERO,
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;

    expect(outcome.path).toBe(workflowFile(project.mbossDir, HERO));
    expect(outcome.written).toEqual(
      pattern.lib.map((file) => join(project.projectDir, file.path)),
    );
    expect(await libFiles()).toEqual([
      'getPurchase.ts',
      'markRefunded.ts',
      'refundApprovalTypes.ts',
      'refundPayment.ts',
      'refundPolicy.ts',
    ]);
  });

  it('writes the code-behind before the document', async () => {
    // So the first generation after a person
    // presses Use finds every handler the drawing
    // names. The manifest cache is the proof: it
    // is written by the scan that runs between the
    // two, and a document written first would have
    // been applied against a `lib/` nothing had
    // read yet.
    const pattern = hero();
    await usePattern(project.projectDir, { pattern, name: HERO });

    const cached = LibManifestSchema.parse(
      JSON.parse(await readFile(manifestFile(project.mbossDir), 'utf8')),
    );

    expect(cached.functions.map((fn) => fn.export).sort()).toEqual([
      'getPurchase',
      'markRefunded',
      'refundPayment',
      'refundPolicy',
    ]);
    expect(
      statSync(join(project.projectDir, LIB_DIR, 'getPurchase.ts')).mtimeMs,
    ).toBeLessThanOrEqual(
      statSync(workflowFile(project.mbossDir, HERO)).mtimeMs,
    );
  });

  it('refuses when a workflow of that name is already there', async () => {
    await applySpec(project.mbossDir, {
      name: HERO,
      spec: { title: 'Mine', nodes: [], edges: [] },
      baseRevision: null,
    });

    const outcome = await usePattern(project.projectDir, {
      pattern: hero(),
      name: HERO,
    });

    expect(outcome).toEqual({
      ok: false,
      code: 'WORKFLOW_EXISTS',
      name: HERO,
    });
    expect(await libFiles()).toEqual([]);
  });

  it('refuses when a lib file is already there, naming the first', async () => {
    // Two of them are already there, so "the first"
    // is a claim about order rather than about the
    // only candidate.
    await mkdir(join(project.projectDir, LIB_DIR), { recursive: true });
    for (const name of ['refundPayment.ts', 'refundPolicy.ts']) {
      await writeFile(join(project.projectDir, LIB_DIR, name), 'export {};\n');
    }

    const outcome = await usePattern(project.projectDir, {
      pattern: hero(),
      name: HERO,
    });

    expect(outcome).toEqual({
      ok: false,
      code: 'LIB_FILE_EXISTS',
      path: join(project.projectDir, LIB_DIR, 'refundPayment.ts'),
    });
    expect(await libFiles()).toEqual(['refundPayment.ts', 'refundPolicy.ts']);
    expect(existsSync(workflowFile(project.mbossDir, HERO))).toBe(false);
  });

  it('refuses a second use of the same pattern under a new name', async () => {
    // The document is free but the handlers are
    // not: a pattern's `lib/` is the same files
    // whatever the workflow is called.
    const pattern = hero();
    await usePattern(project.projectDir, { pattern, name: HERO });

    const outcome = await usePattern(project.projectDir, {
      pattern,
      name: 'second_refund',
    });

    expect(outcome).toMatchObject({ ok: false, code: 'LIB_FILE_EXISTS' });
    expect(existsSync(workflowFile(project.mbossDir, 'second_refund'))).toBe(
      false,
    );
  });

  it('refuses a second use of the same pattern and name', async () => {
    const pattern = hero();
    await usePattern(project.projectDir, { pattern, name: HERO });

    const outcome = await usePattern(project.projectDir, {
      pattern,
      name: HERO,
    });

    expect(outcome).toMatchObject({ ok: false, code: 'WORKFLOW_EXISTS' });
  });

  it('refuses a directory that is not an mBoss project', async () => {
    // The scan writes its cache into `.mboss/`,
    // creating the directory on the way. Left to
    // the apply engine this refusal would arrive
    // after the thing it refuses had been made.
    const outside = join(project.projectDir, 'not-a-project');
    await mkdir(outside, { recursive: true });

    const outcome = await usePattern(outside, { pattern: hero(), name: HERO });

    expect(outcome).toMatchObject({
      ok: false,
      code: 'APPLY_FAILED',
      error: { code: 'NOT_AN_MBOSS_PROJECT' },
      written: [],
    });
    expect(existsSync(join(outside, LIB_DIR))).toBe(false);
  });

  it('refuses a name no workflow file could carry', async () => {
    const outcome = await usePattern(project.projectDir, {
      pattern: hero(),
      name: 'Refund Approval',
    });

    expect(outcome).toEqual({
      ok: false,
      code: 'APPLY_FAILED',
      error: { code: 'WORKFLOW_NOT_FOUND', name: 'Refund Approval' },
      written: [],
    });
    expect(await libFiles()).toEqual([]);
  });
});

describe('blankSpec', () => {
  it('applies, and holds one event trigger on the name', async () => {
    const outcome = await applySpec(project.mbossDir, {
      name: 'nightly_sweep',
      spec: blankSpec('nightly_sweep'),
      baseRevision: null,
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;

    expect(outcome.ir.nodes).toHaveLength(1);
    expect(outcome.ir.nodes[0]).toMatchObject({
      id: 'started',
      kind: 'trigger',
      config: { mode: 'event', topic: 'nightly_sweep' },
    });
    expect(outcome.ir.edges).toEqual([]);
  });
});
