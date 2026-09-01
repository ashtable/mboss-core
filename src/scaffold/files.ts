import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { z } from 'zod';

import {
  conventionsFile,
  historyDir,
  mbossDirOf,
  mcpDir,
  proposalsDir,
  skillsDir,
  workflowsDir,
} from '../apply/paths.js';

import { CI_YML } from './templates/ci.js';
import { dockerCompose } from './templates/compose.js';
import { mbossConfig } from './templates/config.js';
import { conventions } from './templates/conventions.js';
import { DOCKERFILE } from './templates/dockerfile.js';
import {
  DOCKERIGNORE,
  ESLINT_CONFIG_MJS,
  GITIGNORE,
  MCP_JSON,
  MCP_README_MD,
  NVMRC,
  PRETTIERIGNORE,
  PRETTIERRC_JSON,
  VITEST_CONFIG_TS,
} from './templates/dotfiles.js';
import { ENTRYPOINT_MODE, ENTRYPOINT_SH } from './templates/entrypoint.js';
import {
  ENV_MODE,
  PLACEHOLDER_EVENTS_SECRET,
  PLACEHOLDER_LINK_KEYS,
  envExample,
  envFile,
} from './templates/env.js';
import { HEALTH_TEST_TS } from './templates/health-test.js';
import { packageJson } from './templates/package-json.js';
import {
  MIGRATION_DIR,
  MIGRATION_LOCK_TOML,
  MIGRATION_SQL,
  PRISMA_CONFIG_TS,
  PRISMA_SCHEMA,
} from './templates/prisma.js';
import { readme } from './templates/readme.js';
import { TSCONFIG_JSON } from './templates/tsconfig.js';

/**
 * Everything a new project is made of, as text.
 *
 * This half writes nothing and mints nothing, so
 * the file set is a pure function of a name and
 * two secrets and can be pinned against a golden.
 * It does *read*: the runtime under
 * `src/scaffold/app/` and the registry seed are
 * real source in this repo, type-checked and
 * linted here on every change, and they are copied
 * into a project verbatim. Deterministic and
 * filesystem-free are different promises, and only
 * the first one is keepable.
 *
 * Nothing under `src/scaffold/app/` may be
 * *imported* from here, only read. Importing it
 * would pull express, the DBOS SDK and the Prisma
 * client into the import graph of a library whose
 * consumers nest it as source.
 */

/**
 * What a project may be called.
 *
 * The name is a directory, an npm package name, a
 * compose project name and the application name
 * DBOS records against every run, so it has to
 * survive all four: lowercase, no spaces, no
 * separators a path would read. Hyphens are
 * allowed where a workflow name would refuse them
 * — `my-app` is the ordinary way to name a project
 * and there is no file named after it.
 */
export const ProjectNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,40}$/);

export type ScaffoldOptions = {
  /** The project name. Also the compose project
   *  name and the DBOS application name. */
  name: string;
  /** Supplied so that the file set stays a pure
   *  function of its inputs. `scaffoldProject`
   *  mints them. */
  linkKeys?: string;
  eventsSecret?: string;
  /** The MCP bundle, when the caller has it. The
   *  bytes are built in another repository, so
   *  this one cannot produce them. */
  mcpBundle?: { server: string; version: string };
};

export type ScaffoldFile = {
  /** Project-relative, posix separators. */
  path: string;
  contents: string;
  /** 0o600 for `.env` and 0o755 for the
   *  entrypoint; absent means 0o644. */
  mode?: number;
};

/**
 * A project-relative path, in posix, however this
 * platform spells one.
 */
function projectPath(absolute: string, root: string): string {
  return absolute
    .slice(root.length + 1)
    .split(sep)
    .join('/');
}

/**
 * The `.mboss/` layout, taken from the module that
 * owns it rather than rebuilt here. A fourth copy
 * of `join('.mboss', 'workflows')` is how the four
 * would come to disagree.
 *
 * Rooted at `.` so every path those helpers build
 * comes back project-relative: joining a path onto
 * `.` drops the `./` again.
 */
const PROJECT_ROOT = '.';
const MBOSS_DIR = mbossDirOf(PROJECT_ROOT);

function mbossPath(absolute: string): string {
  return absolute.split(sep).join('/');
}

/**
 * Directories a project needs that hold no file:
 * the two gitignored working directories and the
 * two slots a consumer drops a bundle into.
 */
export const SCAFFOLD_DIRS: readonly string[] = [
  '.claude/skills/mboss',
  mbossPath(historyDir(MBOSS_DIR)),
  mbossPath(proposalsDir(MBOSS_DIR)),
  `${mbossPath(skillsDir(MBOSS_DIR))}/mboss`,
].sort();

/** Where the mirrored runtime tree lives here. */
const APP_SOURCE = join(import.meta.dirname, 'app');

/** And where it lands in a project. */
const APP_TARGET = 'src/app';

const REGISTRY_SOURCE = join(import.meta.dirname, 'workflows', 'index.ts');

/**
 * The runtime files a project gets, read off disk.
 *
 * Tests and snapshots are excluded. A test imports
 * vitest, which the runtime has no business
 * carrying along, and a snapshot is an artifact of
 * checking this repo rather than anything a
 * project runs. The one test a project does ship
 * is emitted from a template for exactly that
 * reason.
 */
function copiedRuntime(): ScaffoldFile[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);

      if (statSync(path).isDirectory()) {
        return name === '__snapshots__' ? [] : walk(path);
      }
      return name.endsWith('.test.ts') ? [] : [path];
    });

  return walk(APP_SOURCE).map((path) => ({
    path: `${APP_TARGET}/${projectPath(path, APP_SOURCE)}`,
    contents: readFileSync(path, 'utf8'),
  }));
}

/**
 * The bundle slot, filled or explained.
 *
 * A project whose `.mcp.json` points at a file
 * that is not there gives a coding agent a
 * connection that fails rather than one that is
 * missing, and nothing to read about why. So the
 * empty case ships the note.
 */
function mcpSlot(bundle: ScaffoldOptions['mcpBundle']): ScaffoldFile[] {
  const dir = mbossPath(mcpDir(MBOSS_DIR));

  if (!bundle) return [{ path: `${dir}/README.md`, contents: MCP_README_MD }];

  return [
    { path: `${dir}/server.js`, contents: bundle.server },
    { path: `${dir}/VERSION`, contents: `${bundle.version}\n` },
  ];
}

/**
 * Every file a new project is created with.
 *
 * Sorted by path, so two runs are comparable line
 * by line and a golden diff points at the file
 * that changed.
 */
export function scaffoldFiles(options: ScaffoldOptions): ScaffoldFile[] {
  const name = ProjectNameSchema.parse(options.name);
  const secrets = {
    linkKeys: options.linkKeys ?? PLACEHOLDER_LINK_KEYS,
    eventsSecret: options.eventsSecret ?? PLACEHOLDER_EVENTS_SECRET,
  };

  const files: ScaffoldFile[] = [
    { path: '.dockerignore', contents: DOCKERIGNORE },
    { path: '.env', contents: envFile(name, secrets), mode: ENV_MODE },
    { path: '.env.example', contents: envExample(name) },
    { path: '.github/workflows/ci.yml', contents: CI_YML },
    { path: '.gitignore', contents: GITIGNORE },
    {
      path: mbossPath(conventionsFile(MBOSS_DIR)),
      contents: conventions(name),
    },
    ...mcpSlot(options.mcpBundle),
    { path: `${mbossPath(workflowsDir(MBOSS_DIR))}/.gitkeep`, contents: '' },
    { path: '.mcp.json', contents: MCP_JSON },
    { path: '.nvmrc', contents: NVMRC },
    { path: '.prettierignore', contents: PRETTIERIGNORE },
    { path: '.prettierrc.json', contents: PRETTIERRC_JSON },
    { path: 'Dockerfile', contents: DOCKERFILE },
    { path: 'README.md', contents: readme(name) },
    { path: 'docker-compose.yml', contents: dockerCompose(name) },
    {
      path: 'docker-entrypoint.sh',
      contents: ENTRYPOINT_SH,
      mode: ENTRYPOINT_MODE,
    },
    { path: 'eslint.config.mjs', contents: ESLINT_CONFIG_MJS },
    { path: 'lib/.gitkeep', contents: '' },
    { path: 'mboss.config.ts', contents: mbossConfig(name) },
    { path: 'package.json', contents: packageJson(name) },
    { path: 'prisma.config.ts', contents: PRISMA_CONFIG_TS },
    {
      path: `prisma/migrations/${MIGRATION_DIR}/migration.sql`,
      contents: MIGRATION_SQL,
    },
    {
      path: 'prisma/migrations/migration_lock.toml',
      contents: MIGRATION_LOCK_TOML,
    },
    { path: 'prisma/schema.prisma', contents: PRISMA_SCHEMA },
    ...copiedRuntime(),
    { path: `${APP_TARGET}/health.test.ts`, contents: HEALTH_TEST_TS },
    {
      path: 'src/workflows/index.ts',
      contents: readFileSync(REGISTRY_SOURCE, 'utf8'),
    },
    { path: 'tsconfig.json', contents: TSCONFIG_JSON },
    { path: 'vitest.config.ts', contents: VITEST_CONFIG_TS },
  ];

  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}
