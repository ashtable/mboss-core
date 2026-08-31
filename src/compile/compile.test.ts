import { readFileSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile as read,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { workflowFile, workflowsDir } from '../apply/index.js';
import { scanLib } from '../manifest/index.js';
import { fixturesRoot } from '../test-support/fixtures.js';
import { makeIR } from '../test-support/ir.js';
import {
  makeProject,
  removeProject,
  type TestProject,
} from '../test-support/project.js';

import { compileProject, compileRegistry, compileWorkflow } from './compile.js';

/**
 * The gate, the registry, and what `compileProject`
 * does to a project on disk.
 *
 * The emitted shapes themselves are pinned in
 * `emit-linear.test.ts`; what is here is the
 * behaviour around them — what is refused, what is
 * written, and what is deleted.
 */

const MANIFEST = scanLib(join(fixturesRoot, 'lib'));

const TIMEZONE = 'America/Los_Angeles';

function compile(ir: ReturnType<typeof makeIR>) {
  return compileWorkflow({ ir, manifest: MANIFEST, timezone: TIMEZONE });
}

const TRIGGER = {
  id: 'booking_requested',
  kind: 'trigger',
  title: 'Booking request',
  out: 'WebhookEvent',
  config: { mode: 'event', topic: 'booking.requested' },
} as const;

const PARSE = {
  id: 'parse_request',
  kind: 'step',
  title: 'Parse request',
  handler: { export: 'parseRequest' },
  in: 'WebhookEvent',
  out: 'BookingReq',
  config: {},
} as const;

describe('the compile gate', () => {
  it('refuses a document with no trigger', () => {
    // A legal draft — a canvas is scaffolded empty
    // and the trigger comes later — but not a
    // program: nothing would ever start it.
    const result = compile(makeIR({ nodes: [PARSE] }));

    expect(result).toMatchObject({ ok: false, reason: 'CANNOT_COMPILE' });
    expect(
      result.ok ? [] : 'diagnostics' in result ? result.diagnostics : [],
    ).not.toHaveLength(0);
  });

  it('refuses a document with two triggers', () => {
    const result = compile(
      makeIR({
        nodes: [TRIGGER, { ...TRIGGER, id: 'other_trigger' }, PARSE],
        edges: [{ from: 'booking_requested', to: 'parse_request' }],
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'CANNOT_COMPILE' });
  });

  it('refuses a block whose handler the code-behind does not export', () => {
    const result = compile(
      makeIR({
        nodes: [TRIGGER, { ...PARSE, handler: { export: 'nowhereToBeFound' } }],
        edges: [{ from: 'booking_requested', to: 'parse_request' }],
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'CANNOT_COMPILE' });
    if (result.ok || !('diagnostics' in result)) throw new Error('compiled');
    expect(result.diagnostics.map((found) => found.code)).toContain('V07');
  });

  it('carries the diagnostics rather than a message of its own', () => {
    const result = compile(makeIR({ nodes: [PARSE] }));

    if (result.ok || !('diagnostics' in result)) throw new Error('compiled');
    expect(result.diagnostics[0]).toMatchObject({ code: expect.any(String) });
  });
});

describe('what the compiler cannot emit yet', () => {
  it('reports a condition it cannot read as a path', () => {
    const result = compile(
      makeIR({
        nodes: [
          TRIGGER,
          { ...PARSE, guard: { path: 'items[0]', op: 'exists' } },
        ],
        edges: [{ from: 'booking_requested', to: 'parse_request' }],
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'UNSUPPORTED' });
    if (result.ok || !('message' in result)) throw new Error('compiled');
    expect(result.message).toContain('items[0]');
  });

  it('reports a trigger that names a path but no payload type', () => {
    // Guessing would put a correlation key in the
    // world that nothing can ever find.
    const result = compile(
      makeIR({
        nodes: [
          {
            ...TRIGGER,
            out: undefined,
            config: {
              mode: 'event',
              topic: 'booking.requested',
              idempotencyKeyPath: 'requestId',
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED',
      nodeId: 'booking_requested',
    });
  });
});

describe('compileWorkflow', () => {
  const ir = makeIR({
    name: 'purity',
    nodes: [TRIGGER, PARSE],
    edges: [{ from: 'booking_requested', to: 'parse_request' }],
  });

  it('is a pure function of its inputs', () => {
    // Regeneration being clean is the property CI
    // asserts, and it rests entirely on this.
    expect(compile(ir)).toEqual(compile(ir));
  });

  it('names the file it would be written to', () => {
    const result = compile(ir);

    expect(result.ok && result.path).toBe('src/workflows/purity.workflow.ts');
  });

  it('emits only what the trigger can reach', () => {
    // An island is a legal draft. Emitting it
    // would produce references to values nothing
    // assigns.
    const result = compile(
      makeIR({
        name: 'island',
        nodes: [
          TRIGGER,
          PARSE,
          {
            id: 'orphan_step',
            kind: 'step',
            title: 'Orphan',
            handler: { export: 'findSlot' },
            config: {},
          },
        ],
        edges: [{ from: 'booking_requested', to: 'parse_request' }],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : '').not.toContain('orphan_step');
    expect(result.ok ? result.source : '').not.toContain('findSlot');
  });
});

describe('compileRegistry', () => {
  it('produces exactly the seed the scaffold writes', () => {
    // The seed is real, type-checked source in
    // this repository. If the two ever differ, the
    // first regeneration in somebody's project is
    // a diff they did not make.
    const seed = readFileSync(
      join(import.meta.dirname, '../scaffold/workflows/index.ts'),
      'utf8',
    );

    expect(compileRegistry([])).toBe(seed);
  });

  it('imports each workflow as a namespace and lists it once', () => {
    const source = compileRegistry([
      { name: 'groom_booking', title: 'Groom booking', scheduled: false },
    ]);

    expect(source).toContain(
      "import * as groomBooking from './groom_booking.workflow.js';",
    );
    expect(source).toContain("    name: 'groom_booking',");
    expect(source).toContain("    title: 'Groom booking',");
    expect(source).toContain('    workflowFn: groomBooking.groomBooking,');
    expect(source).toContain('    trigger: groomBooking.trigger,');
    expect(source).toContain('    checkPayload: groomBooking.checkPayload,');
    expect(source).toContain('    waits: groomBooking.waits,');
    expect(source).toContain('    eventWaits: groomBooking.eventWaits,');
    expect(source).toContain('export const schedules: ScheduleEntry[] = [];');
  });

  it('lists a scheduled workflow in both arrays', () => {
    // Once so the ingress can name it and the runs
    // surface can list it, once so the boot can
    // apply its schedule. `WorkflowEntry` carries
    // no schedule field: one authority per fact.
    const source = compileRegistry([
      { name: 'nightly_sweep', title: 'Nightly sweep', scheduled: true },
    ]);

    expect(source).toContain("    name: 'nightly_sweep',");
    expect(source).toContain(
      [
        'export const schedules: ScheduleEntry[] = [',
        '  nightlySweep.schedule,',
        '];',
      ].join('\n'),
    );
  });

  it('lists workflows in name order, whatever order it was given', () => {
    const source = compileRegistry([
      { name: 'b_second', title: 'B', scheduled: false },
      { name: 'a_first', title: 'A', scheduled: false },
    ]);

    expect(source.indexOf('a_first')).toBeLessThan(source.indexOf('b_second'));
  });
});

describe('compileProject', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) await removeProject(project);
    project = undefined;
  });

  async function seed(names: readonly string[]): Promise<TestProject> {
    const made = await makeProject();

    await mkdir(workflowsDir(made.mbossDir), { recursive: true });
    await mkdir(join(made.projectDir, 'lib'), { recursive: true });

    for (const entry of await readdir(join(fixturesRoot, 'lib'))) {
      if (entry.endsWith('.test.ts')) continue;
      await writeFile(
        join(made.projectDir, 'lib', entry),
        await read(join(fixturesRoot, 'lib', entry), 'utf8'),
        'utf8',
      );
    }

    for (const name of names) {
      const ir = makeIR({
        name,
        nodes: [TRIGGER, PARSE],
        edges: [{ from: 'booking_requested', to: 'parse_request' }],
      });

      await writeFile(
        workflowFile(made.mbossDir, name),
        `${JSON.stringify(ir, null, 2)}\n`,
        'utf8',
      );
    }

    return made;
  }

  it('puts a scheduled workflow into the schedules array', async () => {
    // The boot applies the schedules array and
    // prunes anything it does not name, so a
    // scheduled workflow missing from it is a
    // schedule that silently never fires.
    project = await seed([]);
    const ir = makeIR({
      name: 'nightly_sweep',
      title: 'Nightly sweep',
      nodes: [
        {
          id: 'every_night',
          kind: 'trigger',
          title: 'Every night',
          config: { mode: 'schedule', cron: '0 3 * * *' },
        },
      ],
    });
    await writeFile(
      workflowFile(project.mbossDir, 'nightly_sweep'),
      `${JSON.stringify(ir, null, 2)}\n`,
      'utf8',
    );

    await compileProject(project.projectDir, { timezone: TIMEZONE });

    const registry = await read(
      join(project.projectDir, 'src/workflows/index.ts'),
      'utf8',
    );
    expect(registry).toContain('  nightlySweep.schedule,');
    expect(registry).toContain("    name: 'nightly_sweep',");
  });

  it('writes one file per workflow, plus the registry', async () => {
    project = await seed(['first_flow', 'second_flow']);

    const result = await compileProject(project.projectDir, {
      timezone: TIMEZONE,
    });

    expect(result).toMatchObject({
      ok: true,
      written: [
        'src/workflows/first_flow.workflow.ts',
        'src/workflows/index.ts',
        'src/workflows/second_flow.workflow.ts',
      ],
      removed: [],
    });
  });

  it('regenerates byte for byte', async () => {
    // The header carries no timestamp precisely so
    // that this can be asserted.
    project = await seed(['first_flow']);

    await compileProject(project.projectDir, { timezone: TIMEZONE });
    const first = await read(
      join(project.projectDir, 'src/workflows/first_flow.workflow.ts'),
      'utf8',
    );

    await compileProject(project.projectDir, { timezone: TIMEZONE });
    const second = await read(
      join(project.projectDir, 'src/workflows/first_flow.workflow.ts'),
      'utf8',
    );

    expect(second).toBe(first);
  });

  it('deletes the generated file of a workflow that is gone', async () => {
    // Left behind, it stays in the project's own
    // tsconfig and the type-check gate fails on a
    // file nobody is allowed to edit.
    project = await seed(['first_flow', 'second_flow']);
    await compileProject(project.projectDir, { timezone: TIMEZONE });

    await rm(workflowFile(project.mbossDir, 'second_flow'));

    const result = await compileProject(project.projectDir, {
      timezone: TIMEZONE,
    });

    expect(result).toMatchObject({
      ok: true,
      removed: ['src/workflows/second_flow.workflow.ts'],
    });

    const registry = await read(
      join(project.projectDir, 'src/workflows/index.ts'),
      'utf8',
    );
    expect(registry).not.toContain('second_flow');
    await expect(
      read(
        join(project.projectDir, 'src/workflows/second_flow.workflow.ts'),
        'utf8',
      ),
    ).rejects.toThrow();
  });

  it('leaves a hand-written file in the directory alone', async () => {
    // Pruning touches `*.workflow.ts` and nothing
    // else.
    project = await seed(['first_flow']);
    await compileProject(project.projectDir, { timezone: TIMEZONE });

    const path = join(project.projectDir, 'src/workflows/notes.md');
    await writeFile(path, 'mine\n', 'utf8');

    await compileProject(project.projectDir, { timezone: TIMEZONE });

    expect(await read(path, 'utf8')).toBe('mine\n');
  });

  it('reports what it could not compile, and writes nothing', async () => {
    project = await seed(['first_flow']);
    const broken = makeIR({
      name: 'broken_flow',
      nodes: [{ ...PARSE, handler: { export: 'nowhereToBeFound' } }],
    });
    await writeFile(
      workflowFile(project.mbossDir, 'broken_flow'),
      `${JSON.stringify(broken, null, 2)}\n`,
      'utf8',
    );

    const result = await compileProject(project.projectDir, {
      timezone: TIMEZONE,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.map((f) => f.name)).toEqual([
      'broken_flow',
    ]);
    await expect(
      read(join(project.projectDir, 'src/workflows/index.ts'), 'utf8'),
    ).rejects.toThrow();
  });

  it('writes an empty registry for a project with no workflows', async () => {
    project = await seed([]);

    const result = await compileProject(project.projectDir, {
      timezone: TIMEZONE,
    });

    expect(result).toMatchObject({
      ok: true,
      written: ['src/workflows/index.ts'],
    });
  });
});
