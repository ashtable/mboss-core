import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scaffoldFiles } from './files.js';

/**
 * The schema a project gets, against the one this
 * repo generates its Prisma client from.
 *
 * The two have to be the same bytes. The
 * type-check gate resolves `@prisma/client` out of
 * this repo's own installed packages, so a schema
 * that drifted would have the gate checking
 * generated code against a client no project will
 * ever have. Change the template and this test
 * tells you to copy it across.
 */

const CORE = join(import.meta.dirname, '../..');
const FILES = scaffoldFiles({ name: 'my_app' });

function contentsOf(path: string): string {
  const found = FILES.find((file) => file.path === path);
  if (!found) throw new Error(`nothing emitted at ${path}`);

  return found.contents;
}

const SCHEMA = contentsOf('prisma/schema.prisma');
const MIGRATION = contentsOf(
  'prisma/migrations/00000000000000_mboss_runtime/migration.sql',
);

describe('the emitted schema', () => {
  it('is byte-identical to the one this repo generates from', () => {
    const own = readFileSync(join(CORE, 'prisma/schema.prisma'), 'utf8');

    expect(SCHEMA).toBe(own);
  });

  it('declares no connection string, which Prisma 7 refuses there', () => {
    expect(SCHEMA).toContain('provider = "postgresql"');
    expect(SCHEMA).not.toMatch(/^\s*url\s*=/m);
  });

  it('keeps the generator on the client the toolchain resolves', () => {
    // The successor generator writes TypeScript
    // into the source tree, which would put
    // generated code under the same directories
    // the compiler owns and the gate checks.
    expect(SCHEMA).toContain('provider = "prisma-client-js"');
    expect(SCHEMA).not.toMatch(/^\s*output\s*=/m);
  });

  it('keys the correlation table by run and node, not by topic and key', () => {
    // Two runs of one workflow wait on the same
    // node all the time; keying on the topic and
    // the key would make that impossible.
    expect(SCHEMA).toContain('@@id([runId, nodeId])');
    expect(SCHEMA).toContain('@@index([topic, key])');
    expect(SCHEMA).toContain('@@map("mboss_wait_correlations")');
  });
});

describe('the first migration', () => {
  it('creates the table the schema maps to', () => {
    expect(MIGRATION).toContain('CREATE TABLE "mboss_wait_correlations"');
    for (const column of ['runId', 'nodeId', 'topic', 'key']) {
      expect(MIGRATION).toContain(`"${column}" TEXT NOT NULL`);
    }
  });

  it('carries the same primary key and index the schema declares', () => {
    expect(MIGRATION).toContain('PRIMARY KEY ("runId","nodeId")');
    expect(MIGRATION).toContain('CREATE INDEX');
    expect(MIGRATION).toContain('("topic", "key")');
  });

  it('names the provider, so migrate deploy runs on a fresh database', () => {
    const lock = contentsOf('prisma/migrations/migration_lock.toml');

    expect(lock).toContain('provider = "postgresql"');
  });
});
