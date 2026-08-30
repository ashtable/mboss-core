import { access, readFile, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkflowIRSchema } from '../ir/index.js';
import {
  makeProject,
  removeProject,
  type TestProject,
} from '../test-support/project.js';

import type { Failure } from './errors.js';
import {
  applySpec,
  proposeSpec,
  readWorkflow,
  undo,
  type ApplyOutcome,
} from './index.js';
import { lockFile, workflowFile } from './paths.js';

describe('readWorkflow', () => {
  let project: TestProject;

  beforeEach(async () => {
    project = await makeProject();
  });

  afterEach(async () => {
    await removeProject(project);
  });

  it('reads back what was applied', async () => {
    await applySpec(project.mbossDir, {
      name: 'booking',
      spec: { title: 'Booking', nodes: [], edges: [] },
      baseRevision: null,
    });

    expect(await readWorkflow(project.mbossDir, 'booking')).toMatchObject({
      ok: true,
      ir: { name: 'booking', title: 'Booking', revision: 1 },
    });
  });

  it('reports a workflow that is not there', async () => {
    expect(await readWorkflow(project.mbossDir, 'booking')).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_NOT_FOUND', name: 'booking' },
    });
  });

  it('reports a project with no control directory', async () => {
    await rm(project.mbossDir, { recursive: true, force: true });

    expect(await readWorkflow(project.mbossDir, 'booking')).toMatchObject({
      ok: false,
      error: { code: 'NOT_AN_MBOSS_PROJECT', path: project.mbossDir },
    });
  });
});

/**
 * Capitals and a hyphen are the two names an agent
 * reaches for first, and neither is a name a
 * workflow file can carry. That is a well-formed
 * request for something that is not there, which is
 * the one shape of answer this module promises —
 * not a parse error thrown out from under a tool
 * call.
 */
describe('a workflow name no file could carry', () => {
  let project: TestProject;

  beforeEach(async () => {
    project = await makeProject();
  });

  afterEach(async () => {
    await removeProject(project);
  });

  const notFound = { ok: false, error: { code: 'WORKFLOW_NOT_FOUND' } };

  it('is reported by readWorkflow', async () => {
    expect(await readWorkflow(project.mbossDir, 'Booking')).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_NOT_FOUND', name: 'Booking' },
    });
  });

  it('is reported by applySpec', async () => {
    expect(
      await applySpec(project.mbossDir, {
        name: 'booking-flow',
        spec: { nodes: [], edges: [] },
        baseRevision: null,
      }),
    ).toMatchObject(notFound);
  });

  it('is reported by proposeSpec', async () => {
    expect(
      await proposeSpec(project.mbossDir, {
        name: 'my workflow',
        spec: { nodes: [], edges: [] },
        baseRevision: null,
        proposedBy: 'claude code',
      }),
    ).toMatchObject(notFound);
  });

  it('is reported by undo', async () => {
    expect(await undo(project.mbossDir, '../escape')).toMatchObject(notFound);
  });
});

describe('applySpec', () => {
  let project: TestProject;

  beforeEach(async () => {
    project = await makeProject();
  });

  afterEach(async () => {
    await removeProject(project);
  });

  const revisionOnDisk = async (name: string): Promise<number> => {
    const text = await readFile(workflowFile(project.mbossDir, name), 'utf8');

    return WorkflowIRSchema.parse(JSON.parse(text)).revision;
  };

  const create = (name: string): Promise<ApplyOutcome> =>
    applySpec(project.mbossDir, {
      name,
      spec: { title: 'Booking', nodes: [], edges: [] },
      baseRevision: null,
    });

  it('creates a workflow at revision 1', async () => {
    const outcome = await create('booking');

    expect(outcome).toMatchObject({
      ok: true,
      ir: { revision: 1, name: 'booking', title: 'Booking' },
    });
    expect(await revisionOnDisk('booking')).toBe(1);
  });

  it('raises the revision by exactly one on every apply', async () => {
    await create('booking');

    const second = await applySpec(project.mbossDir, {
      name: 'booking',
      spec: { title: 'Booking again', nodes: [], edges: [] },
      baseRevision: 1,
    });

    expect(second).toMatchObject({ ok: true, ir: { revision: 2 } });
  });

  /**
   * The obvious way to write "this document with
   * one more block" is to spread the document that
   * was just read. A `WorkflowIR` is structurally a
   * `WorkflowSpec` carrying extra fields, so
   * nothing stops that spec arriving with the
   * revision it was read at — and a counter that
   * takes it would stop counting, leaving every
   * later base revision matching and the conflict
   * check dead.
   */
  it('sets the revision itself even when the spec carries one', async () => {
    await create('booking');
    const read = await readWorkflow(project.mbossDir, 'booking');
    if (!read.ok) throw new Error('the workflow was not written');

    const second = await applySpec(project.mbossDir, {
      name: 'booking',
      spec: { ...read.ir, title: 'Booking again' },
      baseRevision: read.ir.revision,
    });

    expect(second).toMatchObject({ ok: true, ir: { revision: 2 } });
    expect(await revisionOnDisk('booking')).toBe(2);
  });

  /**
   * The name argument is authoritative: a spec is
   * agent-authored JSON, and one carrying its own
   * name would redirect an approved edit to a
   * different workflow than the one being written.
   */
  it('writes the workflow it was asked for, not the one the spec names', async () => {
    await create('booking');
    await create('payments');

    const other = await readWorkflow(project.mbossDir, 'payments');
    if (!other.ok) throw new Error('the workflow was not written');

    const outcome = await applySpec(project.mbossDir, {
      name: 'booking',
      spec: { ...other.ir, title: 'Booking again' },
      baseRevision: 1,
    });

    expect(outcome).toMatchObject({ ok: true, ir: { name: 'booking' } });
    expect(await readWorkflow(project.mbossDir, 'booking')).toMatchObject({
      ok: true,
      ir: { name: 'booking', title: 'Booking again' },
    });
  });

  it('refuses a project with no control directory', async () => {
    await rm(project.mbossDir, { recursive: true, force: true });

    const outcome = await applySpec(project.mbossDir, {
      name: 'booking',
      spec: { nodes: [], edges: [] },
      baseRevision: null,
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'NOT_AN_MBOSS_PROJECT' },
    });
  });

  it('refuses to edit a workflow that is not there', async () => {
    const outcome = await applySpec(project.mbossDir, {
      name: 'booking',
      spec: { nodes: [], edges: [] },
      baseRevision: 3,
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_NOT_FOUND', name: 'booking' },
    });
  });

  /**
   * A caller passing no base revision is saying it
   * believes there is no such workflow yet, which
   * is as much a claim about the file as any other
   * base revision, and as capable of being wrong.
   */
  it('refuses to create a workflow that already exists', async () => {
    await create('booking');

    expect(await create('booking')).toMatchObject({
      ok: false,
      error: { code: 'REVISION_CONFLICT', expected: null, actual: 1 },
    });
  });

  /**
   * Deliberately same-process: the mutual exclusion
   * under test is a file, so nothing about the race
   * needs a second process to be real, and spawning
   * one would only add a way for this to be flaky.
   */
  it('lets one of two racing appliers win and tells the other why', async () => {
    await create('booking');
    const base = await revisionOnDisk('booking');

    const race = (title: string): Promise<ApplyOutcome> =>
      applySpec(project.mbossDir, {
        name: 'booking',
        spec: { title, nodes: [], edges: [] },
        baseRevision: base,
      });

    const outcomes = await Promise.all([race('First'), race('Second')]);

    const winners = outcomes.filter((outcome) => outcome.ok);
    const losers = outcomes.filter(
      (outcome): outcome is Failure => !outcome.ok,
    );

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.error).toEqual({
      code: 'REVISION_CONFLICT',
      expected: base,
      actual: base + 1,
    });

    expect(await revisionOnDisk('booking')).toBe(base + 1);
    await expect(access(lockFile(project.mbossDir))).rejects.toThrow();
  });
});
