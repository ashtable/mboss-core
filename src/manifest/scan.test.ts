import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  expectGolden,
  fixturesRoot,
} from '../test-support/fixtures.js';
import { scanLib } from './scan.js';
import type { LibFunction, LibManifest } from './types.js';

const manifest = scanLib(join(fixturesRoot, 'lib'));
const unserializable = scanLib(join(fixturesRoot, 'lib-unserializable'));

function exported(name: string): LibFunction {
  return exportedFrom(manifest, name);
}

function exportedFrom(scanned: LibManifest, name: string): LibFunction {
  const found = scanned.functions.find((fn) => fn.export === name);
  if (!found) throw new Error(`${name} is not in the manifest`);
  return found;
}

function withoutScannedAt(
  scanned: LibManifest,
): Omit<LibManifest, 'scannedAt'> {
  return {
    sourceHash: scanned.sourceHash,
    functions: scanned.functions,
    types: scanned.types,
    typeSources: scanned.typeSources,
    nonSerializable: scanned.nonSerializable,
    errors: scanned.errors,
  };
}

describe('scanLib', () => {
  it('offers exactly the handlers the code-behind exports', () => {
    expect(manifest.functions.map((fn) => fn.export).sort()).toEqual([
      'autoApprove',
      'bookAppointment',
      'chargeCard',
      'closeClaim',
      'confirmSlot',
      'fileRefusal',
      'findSlot',
      'parseRequest',
      'payClaim',
      'readReply',
      'recordBooking',
      'recordIntake',
      'routeClaim',
      'sweepStale',
      'tryAgain',
      'twilioChat',
    ]);
  });

  it('skips a test file even though it has a named export', () => {
    expect(manifest.functions.map((fn) => fn.export)).not.toContain(
      'assertParses',
    );
    expect(manifest.functions.map((fn) => fn.file)).not.toContain(
      'lib/helpers.test.ts',
    );
  });

  it('skips a function that is not exported', () => {
    expect(manifest.functions.map((fn) => fn.export)).not.toContain('slotKey');
  });

  it('skips a default export, which no generated import could name', () => {
    expect(manifest.functions.map((fn) => fn.export)).not.toContain('notify');
    expect(manifest.functions.map((fn) => fn.file)).not.toContain(
      'lib/notify.ts',
    );
  });

  it('records the one fixture handler that really reaches a service', () => {
    // The corpus describes calling a service in
    // prose everywhere else and returns a literal,
    // so without this the blessed scan could not
    // carry the field at all.
    expect(exported('chargeCard').externalCalls).toEqual([
      { callee: 'fetch', via: 'globalThis', line: 12 },
    ]);
  });

  it('records where each handler lives, project-relative and posix', () => {
    expect(exported('findSlot').file).toBe('lib/findSlot.ts');
  });

  it('records each parameter by name and written type', () => {
    expect(exported('parseRequest').params).toEqual([
      { name: 'event', type: 'WebhookEvent' },
    ]);
  });

  it('unwraps the Promise an async handler returns', () => {
    expect(exported('findSlot').returnType).toBe('SlotGrid');
  });

  it('leaves a synchronous handler’s return type alone', () => {
    expect(exported('parseRequest').returnType).toBe('BookingReq');
  });

  it('takes the JSDoc summary and leaves the tags out of it', () => {
    const doc = exported('parseRequest').doc;

    expect(doc).toBe(
      'Flattens the incoming webhook into the shape the rest of the ' +
        'workflow reads.',
    );
    expect(doc).not.toContain('@param');
  });

  it('lists exported interfaces and type aliases alike', () => {
    expect(manifest.types).toEqual([
      'Booking',
      'BookingReq',
      'ChatPrompt',
      'ChatReply',
      'ExpenseClaim',
      'IntakeAnswers',
      'IntakeRecord',
      'IntakeRequest',
      'Payment',
      'Refusal',
      'Routing',
      'SlotGrid',
      'WebhookEvent',
    ]);
  });

  it('says which file each exported type came from', () => {
    // A bare list of names cannot produce
    // `import type { Booking } from …`, which is
    // what the compiler has to emit.
    expect(manifest.typeSources['Booking']).toBe('lib/types.ts');
    expect(manifest.typeSources['ChatReply']).toBe('lib/types.ts');
    expect(manifest.typeSources['IntakeAnswers']).toBe('lib/intake.ts');
    expect(manifest.typeSources['Payment']).toBe('lib/expense.ts');
  });

  it('reports no errors for code that compiles', () => {
    expect(manifest.errors).toEqual([]);
  });

  it('knows the Node globals a handler is written against', () => {
    // `twilioChat` reads its credential out of the
    // environment, which the project's own tsc
    // compiles without complaint. A scan that
    // called that a type error would send whoever
    // reads the manifest off to fix working code.
    const file = exported('twilioChat').file;

    expect(manifest.errors.filter((error) => error.file === file)).toEqual([]);
  });

  it('stamps the scan with an instant, which is why it is not in the golden', () => {
    expect(Number.isNaN(Date.parse(manifest.scannedAt))).toBe(false);
    expect(new Date(manifest.scannedAt).toISOString()).toBe(manifest.scannedAt);
  });

  it('finds nothing in the fixture code-behind that cannot travel', () => {
    expect(manifest.nonSerializable).toEqual([]);
  });

  it('matches the blessed manifest', () => {
    expectGolden(
      'golden/manifest/lib.manifest.json',
      canonicalJson(withoutScannedAt(manifest)),
    );
  });
});

describe('scanLib on code-behind that cannot travel between blocks', () => {
  it('offers an exported class as a type a node can declare', () => {
    // Without this, a class instance could never
    // be a node's declared input or output, and
    // the rule about class instances would be
    // about a state no document could reach.
    expect(unserializable.types).toContain('Session');
    expect(unserializable.typeSources['Session']).toBe(
      'lib-unserializable/types.ts',
    );
  });

  it('compiles cleanly, so a finding is about meaning not error', () => {
    expect(unserializable.errors).toEqual([]);
  });

  it('names the member at fault for each reason a type can fail', () => {
    expect(unserializable.nonSerializable).toEqual([
      { type: 'Conn', path: 'socket', reason: 'handle' },
      { type: 'Feed', path: 'stream', reason: 'stream' },
      { type: 'Job', path: 'payload.onDone', reason: 'function' },
      { type: 'Session', path: '', reason: 'class' },
      { type: 'Ticket', path: 'onDone', reason: 'function' },
      { type: 'Upload', path: 'body', reason: 'buffer' },
    ]);
  });

  it('matches the blessed manifest', () => {
    expectGolden(
      'golden/manifest/lib-unserializable.manifest.json',
      canonicalJson(withoutScannedAt(unserializable)),
    );
  });

  it('orders findings by type and then by member', () => {
    // Both halves matter, and neither follows the
    // source: the manifest is a blessed artifact,
    // so two scans of the same code have to agree
    // whatever order the checker hands members
    // back in.
    const source = [
      'export interface Beta { z: () => void; a: Buffer }',
      'export interface Alpha { m: Buffer }',
    ].join('\n');

    expect(scannedFromSource(source).nonSerializable).toEqual([
      { type: 'Alpha', path: 'm', reason: 'buffer' },
      { type: 'Beta', path: 'a', reason: 'buffer' },
      { type: 'Beta', path: 'z', reason: 'function' },
    ]);
  });
});

/**
 * One code-behind file carrying the two shapes the
 * blessed fixtures do not: a call that may leave
 * arguments out, and the return types a branch's
 * decision is read off.
 */
const shapes = scannedFromSource(
  [
    "export type Verdict = 'yes' | 'no';",
    '',
    'export function greet(',
    '  name: string,',
    '  salutation?: string,',
    '  times = 1,',
    '): string {',
    "  return `${salutation ?? 'hi'} ${name}`.repeat(times);",
    '}',
    '',
    'export async function judge(): Promise<Verdict> {',
    "  return 'yes';",
    '}',
    '',
    'export async function reachedTen(count: number): Promise<boolean> {',
    '  return count >= 10;',
    '}',
    '',
    'export async function countStale(): Promise<number> {',
    '  return 0;',
    '}',
    '',
    'export async function maybeJudge(): Promise<Verdict | undefined> {',
    '  return undefined;',
    '}',
  ].join('\n'),
);

describe('scanLib on optional parameters and decision return types', () => {
  it('compiles cleanly, so nothing here is read off broken code', () => {
    expect(shapes.errors).toEqual([]);
  });

  it('marks the parameters a call may leave out', () => {
    // A question mark and a default are the same
    // fact at the call site, and it is the call
    // site the rule about handler arity is about.
    expect(exportedFrom(shapes, 'greet').params).toEqual([
      { name: 'name', type: 'string' },
      { name: 'salutation', type: 'string', optional: true },
      { name: 'times', type: 'number', optional: true },
    ]);
  });

  it('reads a decision through the alias it was written as', () => {
    // `returnType` prints the type the way the
    // source wrote it, so the text is `Verdict` and
    // says nothing about what a Verdict can be.
    const fn = exportedFrom(shapes, 'judge');

    expect(fn.returnType).toBe('Verdict');
    expect(fn.decision).toEqual(['yes', 'no']);
  });

  it('reads a boolean as the two values it decides between', () => {
    expect(exportedFrom(shapes, 'reachedTen').decision).toEqual([true, false]);
  });

  it('records no decision for a return type that is not one', () => {
    expect(exportedFrom(shapes, 'countStale').decision).toBeUndefined();

    // A union carrying anything but literals is
    // not a set of cases either, and reading one
    // as though it were would ask a branch to
    // handle a value that has no name.
    expect(exportedFrom(shapes, 'maybeJudge').decision).toBeUndefined();
  });
});

/**
 * One code-behind whose handlers really do reach
 * another machine, in each shape a person writes
 * one.
 */
const CALLS_OUT = [
  "import * as http2 from 'http2';",
  "import { request } from 'node:https';",
  "import { Resolver } from 'node:dns';",
  "import { Socket } from 'node:net';",
  '',
  'const DEBUG_REMOTE = false;',
  '',
  'export async function chargeByFetch(url: string): Promise<number> {',
  '  const answer = await fetch(url);',
  '',
  '  return answer.status;',
  '}',
  '',
  'export async function chargeByGlobal(url: string): Promise<number> {',
  '  const answer = await globalThis.fetch(url);',
  '',
  '  return answer.status;',
  '}',
  '',
  'export function chargeByRequest(host: string): void {',
  '  request({ host }).end();',
  '}',
  '',
  'export function chargeByHttp2(url: string): void {',
  '  http2.connect(url).close();',
  '}',
  '',
  'export function chargeByNewSocket(port: number): void {',
  '  new Socket().connect(port);',
  '}',
  '',
  'export function chargeByNewResolver(host: string): void {',
  '  new Resolver().resolve4(host, () => {});',
  '}',
  '',
  'export async function chargeTwice(url: string): Promise<number> {',
  '  const first = await fetch(`${url}/one`);',
  '  const second = await fetch(`${url}/two`);',
  '',
  '  return first.status + second.status;',
  '}',
  '',
  'export async function chargeEach(urls: string[]): Promise<number[]> {',
  '  const answers = await Promise.all(urls.map((url) => fetch(url)));',
  '',
  '  return answers.map((answer) => answer.status);',
  '}',
  '',
  'export async function chargeWrapped(url: string): Promise<number> {',
  '  const one = await (fetch)(`${url}/a`);',
  '  const two = await fetch!(`${url}/b`);',
  '  const three = await (fetch as typeof fetch)(`${url}/c`);',
  '  const four = await (fetch satisfies typeof fetch)(`${url}/d`);',
  '',
  '  return one.status + two.status + three.status + four.status;',
  '}',
  '',
  'export async function chargeOnDefault(',
  '  url: string,',
  '  first: Promise<Response> = fetch(`${url}/first`),',
  '): Promise<number> {',
  '  const second = await fetch(`${url}/second`);',
  '',
  '  return (await first).status + second.status;',
  '}',
  '',
  'export async function chargeWhenDebugging(url: string): Promise<void> {',
  '  if (DEBUG_REMOTE) {',
  '    await fetch(`${url}/whenDebugging`);',
  '  }',
  '}',
  '',
  'export async function chargeAndDescribe(url: string): Promise<string> {',
  '  const retry = async (): Promise<number> =>',
  '    (await fetch(`${url}/retry`)).status;',
  '',
  '  return typeof retry;',
  '}',
];

const callsOut = scannedFromSource(CALLS_OUT.join('\n'));

/**
 * One code-behind that calls nothing of the sort,
 * written out of the things a rule reading this
 * loosely would flag.
 */
const STAYS_HOME = [
  "import { validateHeaderName } from 'node:http';",
  "import { randomUUID } from 'node:crypto';",
  "import { readFile } from 'node:fs/promises';",
  "import { BlockList, isIP } from 'node:net';",
  "import { getServers } from 'node:dns';",
  "import { getDefaultSettings, getPackedSettings } from 'node:http2';",
  "import { checkServerIdentity, getCiphers } from 'node:tls';",
  "import type { PeerCertificate } from 'node:tls';",
  "import * as https from 'node:https';",
  '',
  'export function makeId(): string {',
  '  return randomUUID();',
  '}',
  '',
  'export async function readTemplate(path: string): Promise<string> {',
  "  return readFile(path, 'utf8');",
  '}',
  '',
  'export function isAnAddress(host: string): boolean {',
  '  return isIP(host) !== 0;',
  '}',
  '',
  'export function isAHeader(name: string): boolean {',
  '  validateHeaderName(name);',
  '',
  '  return true;',
  '}',
  '',
  'export function buildAgent(): https.Agent {',
  '  return new https.Agent({});',
  '}',
  '',
  'export function lookUp(key: string): string {',
  '  const fetch = (url: string) => url.toUpperCase();',
  '',
  '  return fetch(key);',
  '}',
  '',
  'export function summarise(rows: number[]): string {',
  '  const kept = rows.map((row) => row * 2).filter((row) => row > 0);',
  '  const when = new Date().toISOString();',
  '',
  '  console.log(JSON.parse(JSON.stringify(kept)));',
  '',
  '  return `${when} ${Buffer.from(when).toString("base64")}`;',
  '}',
  '',
  'export function trace(note: string): void {',
  '  process.stdout.write(note);',
  "  process.stderr.write('\\n');",
  '}',
  '',
  'export function isDenied(host: string): boolean {',
  '  const denied = new BlockList();',
  '',
  '  return denied.check(host);',
  '}',
  '',
  'export function isDeniedInline(host: string): boolean {',
  '  return new BlockList().check(host);',
  '}',
  '',
  'export function certificateProblem(',
  '  host: string,',
  '  cert: PeerCertificate,',
  '): string {',
  "  return checkServerIdentity(host, cert)?.message ?? '';",
  '}',
  '',
  'export function packSettings(): string {',
  "  return getPackedSettings(getDefaultSettings()).toString('base64');",
  '}',
  '',
  'export function localSetup(): string {',
  "  return [...getServers(), ...getCiphers()].join(' ');",
  '}',
];

const staysHome = scannedFromSource(STAYS_HOME.join('\n'));

describe('scanLib on handlers that reach another system', () => {
  it('compiles cleanly, so nothing here is read off broken code', () => {
    expect(callsOut.errors).toEqual([]);
    expect(staysHome.errors).toEqual([]);
  });

  it('records the global fetch under the global it came from', () => {
    expect(exportedFrom(callsOut, 'chargeByFetch').externalCalls).toEqual([
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, 'await fetch(url)'),
      },
    ]);
  });

  it('reads globalThis.fetch as the same call, not a different one', () => {
    // The two spellings are one thing, so a
    // person cannot get out of the rule by
    // writing the longer one.
    expect(exportedFrom(callsOut, 'chargeByGlobal').externalCalls).toEqual([
      {
        callee: 'globalThis.fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, 'globalThis.fetch(url)'),
      },
    ]);
  });

  it('names the Node module a call was resolved into', () => {
    // One entry and not two, though the line holds
    // two calls: `.end()` is a method on what
    // `request` returned, and the call that
    // reached out is the one recorded.
    expect(exportedFrom(callsOut, 'chargeByRequest').externalCalls).toEqual([
      {
        callee: 'request',
        via: 'node:https',
        line: lineOf(CALLS_OUT, 'request({ host })'),
      },
    ]);
  });

  it('reads the bare specifier as the module it is', () => {
    // `http2` and `node:http2` are the same module
    // to the checker, which is why one entry in
    // the rule covers both ways of importing it.
    expect(exportedFrom(callsOut, 'chargeByHttp2').externalCalls).toEqual([
      {
        callee: 'http2.connect',
        via: 'node:http2',
        line: lineOf(CALLS_OUT, 'http2.connect(url)'),
      },
    ]);
  });

  it('sees a call on a socket constructed on the same line', () => {
    // Constructing is not the call, and the call
    // on what was constructed is not a call on
    // what another call returned: there is no
    // inner call for this one to be recorded
    // under, so the line it is written on is the
    // only place it can be named. Naming the
    // socket first has always been caught, and
    // the two spellings run the same code.
    expect(exportedFrom(callsOut, 'chargeByNewSocket').externalCalls).toEqual([
      {
        callee: 'new Socket().connect',
        via: 'node:net',
        line: lineOf(CALLS_OUT, 'new Socket().connect'),
      },
    ]);
  });

  it('sees a query on a resolver constructed on the same line', () => {
    // The same shape reached through a different
    // declaration: `resolve4` on a resolver is a
    // property whose type is the module's own
    // function, and it resolves through to it.
    expect(exportedFrom(callsOut, 'chargeByNewResolver').externalCalls).toEqual(
      [
        {
          callee: 'new Resolver().resolve4',
          via: 'node:dns',
          line: lineOf(CALLS_OUT, 'new Resolver().resolve4'),
        },
      ],
    );
  });

  it('records every call in the body, in the order they are written', () => {
    expect(exportedFrom(callsOut, 'chargeTwice').externalCalls).toEqual([
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/one'),
      },
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/two'),
      },
    ]);
  });

  it('sees a call inside a callback the handler hands off', () => {
    // It runs inside the transaction just the
    // same, so where in the body it was written
    // cannot be what decides.
    expect(exportedFrom(callsOut, 'chargeEach').externalCalls).toEqual([
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, 'Promise.all'),
      },
    ]);
  });

  it('reads through the wrappers that change nothing', () => {
    // Parentheses, a non-null assertion and a cast
    // all leave the same function being called, so
    // none of them is a way out of the rule. The
    // name recorded is the one a person can search
    // their file for, not the wrapper around it.
    expect(exportedFrom(callsOut, 'chargeWrapped').externalCalls).toEqual([
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/a'),
      },
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/b'),
      },
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/c'),
      },
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/d'),
      },
    ]);
  });

  it('sees a call standing as a default for a parameter', () => {
    // It runs when the argument is left out, which
    // is inside the transaction like everything
    // else in the function. Parameters come first
    // because that is the order they run in.
    expect(exportedFrom(callsOut, 'chargeOnDefault').externalCalls).toEqual([
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/first'),
      },
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/second'),
      },
    ]);
  });

  it('counts a call a branch of the body may never reach', () => {
    // Whether the branch runs is not something
    // reading one function can answer, and the
    // line named is a real line of the handler
    // that a person can go and look at.
    expect(exportedFrom(callsOut, 'chargeWhenDebugging').externalCalls).toEqual(
      [
        {
          callee: 'fetch',
          via: 'globalThis',
          line: lineOf(CALLS_OUT, '${url}/whenDebugging'),
        },
      ],
    );
  });

  it('counts a call inside a closure the body only hands on', () => {
    // The same trade as the callback above: an
    // arrow handed to `map` has to count, and
    // telling that apart from one that leaves the
    // function needs to know where it goes. The
    // repair reads the same either way.
    expect(exportedFrom(callsOut, 'chargeAndDescribe').externalCalls).toEqual([
      {
        callee: 'fetch',
        via: 'globalThis',
        line: lineOf(CALLS_OUT, '${url}/retry'),
      },
    ]);
  });

  it('leaves the field off a handler that reaches nothing', () => {
    // Absent, not empty: whoever reads this reads
    // absence as "the scan did not say", and a
    // cache an older build wrote has to mean the
    // same as a clean one.
    for (const fn of staysHome.functions) {
      expect(fn.externalCalls).toBeUndefined();
    }
  });

  it('says nothing about the Node modules that are not the network', () => {
    expect(exportedFrom(staysHome, 'makeId').externalCalls).toBeUndefined();
    expect(
      exportedFrom(staysHome, 'readTemplate').externalCalls,
    ).toBeUndefined();
  });

  it('says nothing about the pure functions inside networking modules', () => {
    // `isIP` tests a string and
    // `validateHeaderName` tests a name; a handler
    // may reasonably call either before writing a
    // row.
    expect(
      exportedFrom(staysHome, 'isAnAddress').externalCalls,
    ).toBeUndefined();
    expect(exportedFrom(staysHome, 'isAHeader').externalCalls).toBeUndefined();
  });

  it('says nothing about printing to the process own streams', () => {
    // `process.stdout` is a `net.Socket`, so
    // `write` is declared in the same file as the
    // calls that dial out — and printing a line
    // reaches no further than the terminal.
    expect(exportedFrom(staysHome, 'trace').externalCalls).toBeUndefined();
  });

  it('says nothing about a method on an object those modules declare', () => {
    // `BlockList.check` tests an address against a
    // list already in memory. It resolves into
    // `node:net` all the same, so what a call
    // resolves to cannot be the whole answer.
    expect(exportedFrom(staysHome, 'isDenied').externalCalls).toBeUndefined();
    expect(
      exportedFrom(staysHome, 'isDeniedInline').externalCalls,
    ).toBeUndefined();
  });

  it('says nothing about the settings those modules compute and read', () => {
    // Comparing a certificate to a hostname,
    // packing a settings frame and reading the
    // resolvers this machine is configured with
    // are all ordinary things to do before writing
    // a row, and none of them opens a connection.
    expect(
      exportedFrom(staysHome, 'certificateProblem').externalCalls,
    ).toBeUndefined();
    expect(
      exportedFrom(staysHome, 'packSettings').externalCalls,
    ).toBeUndefined();
    expect(exportedFrom(staysHome, 'localSetup').externalCalls).toBeUndefined();
  });

  it('says nothing about building a thing that could talk to a machine', () => {
    expect(exportedFrom(staysHome, 'buildAgent').externalCalls).toBeUndefined();
  });

  it('says nothing about a local name that happens to be fetch', () => {
    // Matched by the declaration it resolves to,
    // so a person who named their own function
    // this is not caught by it.
    expect(exportedFrom(staysHome, 'lookUp').externalCalls).toBeUndefined();
  });

  it('says nothing about the ordinary calls every body makes', () => {
    expect(exportedFrom(staysHome, 'summarise').externalCalls).toBeUndefined();
  });

  it('follows a name the project re-exports through to what it is', () => {
    // The case that decides how this is read at
    // all: the file imports from `./net.js`, so
    // anything matching on the specifier is
    // silent here.
    const barrel = scannedFromSource({
      'net.ts': "export { request as post } from 'node:https';\n",
      'types.ts': [
        "import { post } from './net.js';",
        '',
        'export function charge(host: string): void {',
        '  post({ host }).end();',
        '}',
      ].join('\n'),
    });

    expect(barrel.errors).toEqual([]);
    expect(exportedFrom(barrel, 'charge').externalCalls).toEqual([
      { callee: 'post', via: 'node:https', line: 4 },
    ]);
  });
});

/**
 * A scan of a throwaway code-behind: one file, or
 * a whole `lib/` given as filename to source.
 *
 * The two blessed fixtures are the shapes worth
 * keeping on disk to look at; a sample that exists
 * only to pin an ordering is not one of them.
 */
function scannedFromSource(
  source: string | Record<string, string>,
): LibManifest {
  const files = typeof source === 'string' ? { 'types.ts': source } : source;
  const projectDir = mkdtempSync(join(tmpdir(), 'mboss-'));

  try {
    mkdirSync(join(projectDir, 'lib'));

    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(projectDir, 'lib', name), contents);
    }

    return scanLib(join(projectDir, 'lib'));
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

/**
 * The line a call sits on, found by the text of
 * the call itself so that a case reads as what it
 * is about rather than as a number to count out.
 */
function lineOf(source: readonly string[], text: string): number {
  const found = source.filter((line) => line.includes(text));

  if (found.length !== 1) {
    throw new Error(`${found.length} lines contain ${text}, expected one`);
  }

  return source.indexOf(found[0] as string) + 1;
}
