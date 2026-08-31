import { readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WaitDescriptor } from '../scaffold/app/contract.js';
import {
  renderApprovalDonePage,
  renderApprovalPage,
} from '../scaffold/app/pages/approval.js';
import { renderFormPage } from '../scaffold/app/pages/form.js';
import { scaffoldProject } from '../scaffold/index.js';
import { copyFixtureLib, fixturesRoot } from '../test-support/fixtures.js';
import {
  makeTypecheckProject,
  removeTypecheckProject,
  type TypecheckProject,
} from '../test-support/typecheck.js';

import { compileRegistry } from './compile.js';
import { camelCase } from './names.js';

/**
 * Every generated workflow module, imported and
 * evaluated for real.
 *
 * Nothing else in this batch runs a line of
 * generated code. A golden compares text and the
 * type-check gate compiles it, and neither of them
 * executes a statement — so the module-scope
 * registration, the shapes the registry and the
 * routes read off these modules at run time, and
 * the mere fact that importing one does not throw
 * are all unchecked until here.
 *
 * The registration is the reason this file exists.
 * It is one call, at module scope, and everything
 * downstream depends on it having run: the ingress
 * enqueues by the registered name, and the
 * registry hands DBOS the value registration gave
 * back. The stub records both, so the name is
 * checked against the snake_case name in the IR
 * and the exported binding is checked to be the
 * registered function rather than the bare one.
 *
 * The input is the blessed compiler output rather
 * than a fresh compile. The two are the same
 * bytes — `emit-linear.test.ts` fails the moment
 * they are not — and reading the goldens keeps
 * this file about evaluation instead of about
 * compilation.
 *
 * What this deliberately does NOT prove:
 *
 * - That the generated app runs. No Postgres is
 *   started, DBOS is not launched, the project's
 *   real dependency tree is never installed and no
 *   request is served. Those cross process
 *   boundaries and belong to the durability
 *   end-to-end suite in another repository.
 * - That every relative import carries its `.js`.
 *   Vite resolves an extensionless specifier
 *   quite happily, and so does the type-checker;
 *   the app's own loader is the only thing that
 *   would refuse. That rule is held by the
 *   specifier audit, which is run over this whole
 *   tree in `integration.test.ts` and has a test
 *   of its own proving it reports.
 * - That the emitted syntax is erasable. Type
 *   stripping is what the app starts under and
 *   esbuild's transform is what runs here, which
 *   is more forgiving. `erasableSyntaxOnly` in the
 *   project's own `tsconfig` is what holds that,
 *   at the gate.
 */

/**
 * What the SDK was asked to register, in the order
 * it was asked.
 *
 * `registerWorkflow` hands back a *different*
 * function from the one it was given, which the
 * real one also does. A passthrough would make the
 * registry's `workflowFn` indistinguishable from
 * the undecorated function, and telling those two
 * apart is the whole reason this assertion exists.
 */
const registered = vi.hoisted(
  () => [] as { raw: unknown; wrapped: unknown; config: { name?: string } }[],
);

vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: {
    registerWorkflow: (raw: (...args: never[]) => unknown, config: object) => {
      const wrapped = async (...args: never[]): Promise<unknown> =>
        raw(...args);

      registered.push({ raw, wrapped, config });
      return wrapped;
    },
    runStep: async (func: () => Promise<unknown>) => await func(),
    recv: async () => null,
    sleep: async () => {},
    send: async () => {},
    workflowID: 'wf_test',
  },
}));

/** Only `schedule_trigger` carries a schedule. */
const SCHEDULED = 'schedule_trigger';

const GOLDENS = join(fixturesRoot, 'golden', 'compile');

/**
 * Read here rather than in the setup below: the
 * list is what the cases are generated from, and
 * vitest collects those before any hook runs.
 */
const NAMES = readdirSync(GOLDENS)
  .filter((file) => file.endsWith('.workflow.ts'))
  .map((file) => file.replace('.workflow.ts', ''))
  .sort();

let project: TypecheckProject;

/**
 * The compiled workflows, in a project laid out
 * the way they are compiled for.
 *
 * The goldens are the compiler's own output, byte
 * for byte, but they cannot be imported where they
 * sit: `../app/contract.js` resolves out of
 * `src/workflows/` and nowhere else. So a project
 * is scaffolded around them, which is also what
 * makes the runtime modules they import real ones.
 */
beforeAll(async () => {
  project = await makeTypecheckProject();

  await scaffoldProject(project.projectDir, { name: 'smoke_app' });
  copyFixtureLib(project.projectDir);

  const target = join(project.projectDir, 'src', 'workflows');

  await mkdir(target, { recursive: true });
  for (const name of NAMES) {
    await writeFile(
      join(target, `${name}.workflow.ts`),
      await readFile(join(GOLDENS, `${name}.workflow.ts`), 'utf8'),
      'utf8',
    );
  }

  await writeFile(
    join(target, 'index.ts'),
    compileRegistry(
      NAMES.map((name) => ({
        name,
        title: name,
        scheduled: name === SCHEDULED,
      })),
    ),
    'utf8',
  );
}, 120_000);

afterAll(async () => {
  if (project) await removeTypecheckProject(project);
});

/** One generated file under `src/workflows`. */
async function loadFile(file: string): Promise<Record<string, unknown>> {
  const path = join(project.projectDir, 'src', 'workflows', file);

  return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
}

/** One generated workflow module, evaluated. */
async function load(name: string): Promise<Record<string, unknown>> {
  return await loadFile(`${name}.workflow.ts`);
}

describe('the generated modules', () => {
  it('is a real list, so a clean pass is not an empty one', () => {
    expect(NAMES.length).toBeGreaterThan(10);
    expect(NAMES).toContain('groom_booking');
    expect(NAMES).toContain('approval_flow');
    expect(NAMES).toContain(SCHEDULED);
  });
});

describe.each(NAMES)('%s, imported under a stubbed SDK', (name) => {
  it('registers itself at module scope, under its IR name', async () => {
    const before = registered.length;
    const module = await load(name);
    const calls = registered.slice(before);

    expect(calls.map((call) => call.config.name)).toEqual([name]);
    // The exported binding is what registration
    // gave back. Two exported spellings of one
    // workflow is how half an app ends up calling
    // the unregistered one, so the undecorated
    // function is not exported at all.
    expect(module[camelCase(name)]).toBe(calls[0]?.wrapped);
    expect(module[camelCase(name)]).not.toBe(calls[0]?.raw);
    expect(module).not.toHaveProperty(`${camelCase(name)}Fn`);
  });

  it('exports the four things the registry reads', async () => {
    const module = await load(name);

    expect(typeof module.trigger).toBe('object');
    expect(typeof module.checkPayload).toBe('function');
    expect(typeof module.waits).toBe('object');
    expect(Array.isArray(module.eventWaits)).toBe(true);
  });
});

describe('the generated registry', () => {
  it('points every entry at the registered function', async () => {
    const module = (await loadFile('index.ts')) as unknown as {
      workflows: { name: string; workflowFn: unknown }[];
      schedules: { scheduleName: string; workflowFn: unknown }[];
    };

    expect(module.workflows.map((entry) => entry.name)).toEqual(NAMES);
    for (const entry of module.workflows) {
      const call = registered.find((made) => made.config.name === entry.name);

      expect(entry.workflowFn).toBe(call?.wrapped);
    }
    expect(module.schedules.map((entry) => entry.scheduleName)).toEqual([
      SCHEDULED,
    ]);
  });
});

describe("the event trigger's payload check", () => {
  let checkPayload: (payload: unknown) => Record<string, unknown>;

  beforeAll(async () => {
    const module = await load('event_trigger');
    checkPayload = module.checkPayload as typeof checkPayload;
  });

  it('refuses a payload that is not an object', () => {
    expect(checkPayload(null)).toEqual({
      ok: false,
      problem: 'the payload is not an object',
    });
  });

  it('names the field when the idempotency key is missing', () => {
    expect(checkPayload({})).toEqual({
      ok: false,
      problem: 'requestId is missing',
    });
  });

  it('treats an empty key as missing, not as present', () => {
    // A blank string is what a form post and a
    // JSON body with a null both arrive as. It
    // would otherwise become a workflow id every
    // later delivery matched.
    expect(checkPayload({ requestId: '' })).toEqual({
      ok: false,
      problem: 'requestId is missing',
    });
  });

  it('names the field when the requester is missing', () => {
    expect(checkPayload({ requestId: 'r-1' })).toEqual({
      ok: false,
      problem: 'customer.email is missing',
    });
  });

  it('answers a good payload with the two values it found', () => {
    expect(
      checkPayload({
        requestId: 'r-1',
        customer: { email: 'sam@example.com' },
      }),
    ).toEqual({ ok: true, key: 'r-1', requesterEmail: 'sam@example.com' });
  });
});

describe("the schedule fixture's descriptor", () => {
  it('carries the five flat fields the boot reads', async () => {
    const module = await load(SCHEDULED);
    const schedule = module.schedule as Record<string, unknown>;

    expect(Object.keys(schedule)).toEqual([
      'scheduleName',
      'workflowFn',
      'schedule',
      'cronTimezone',
      'automaticBackfill',
    ]);
    expect(schedule.scheduleName).toBe(SCHEDULED);
    expect(schedule.workflowFn).toBe(module[camelCase(SCHEDULED)]);
    expect(schedule.schedule).toBe('0 3 * * *');
    expect(schedule.cronTimezone).toBe('Europe/Berlin');
    expect(schedule.automaticBackfill).toBe(true);
  });
});

describe('a compiled wait, handed to the page that shows it', () => {
  // The closest anything gets to rendering a real
  // emitted descriptor. Everywhere else the pages
  // are snapshotted against descriptors a test
  // wrote by hand, so a field the compiler emits
  // under a name the page does not read would show
  // up nowhere.
  it('renders the form page from the compiled descriptor', async () => {
    const module = await load('form_intake');
    const waits = module.waits as Record<string, WaitDescriptor>;
    const wait = waits.await_details as WaitDescriptor;

    const html = renderFormPage({
      appTitle: 'Smoke app',
      runId: 'wf_test',
      recipient: 'sam@example.com',
      action: '/f/token',
      wait,
      uploadsEnabled: true,
    });

    expect(html).toContain('Wait for the details');
    for (const field of wait.fields) expect(html).toContain(field.label);
  });

  it('renders the approval page from the compiled descriptor', async () => {
    const module = await load('approval_flow');
    const waits = module.waits as Record<string, WaitDescriptor>;
    const wait = waits.manager_ok as WaitDescriptor;

    expect(wait.page).toBe('approval');

    const html = renderApprovalPage({
      appTitle: 'Smoke app',
      runId: 'wf_test',
      recipient: 'ops@example.com',
      action: '/f/token',
      wait,
    });

    expect(html).toContain('Manager decides');
    // The blocks still to come are listed after
    // the decision, not before it, so that is
    // where the compiled titles have to arrive.
    expect(
      renderApprovalDonePage({
        appTitle: 'Smoke app',
        runId: 'wf_test',
        approved: true,
        downstream: wait.downstream,
      }),
    ).toContain('Close the claim');
  });
});
