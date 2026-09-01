/**
 * The project's `package.json`.
 *
 * Built from objects rather than written out as
 * JSON text: the key order is then visible in the
 * source, and a range can be read off one line
 * instead of counted out of a blob.
 *
 * Two placements are deliberate and both fail at
 * container start rather than at build time if
 * they are moved. `tsx` is a runtime dependency —
 * the entrypoint execs it, so an install that
 * omitted development dependencies would leave the
 * container with nothing to run. `prisma` and
 * `dotenv` stay development dependencies, which is
 * why the Dockerfile does not pass `--omit=dev`.
 */

/**
 * Every range here is mirrored by mBoss's own
 * `package.json` at the identical string, and a
 * test compares them. Without that the type-check
 * gate would happily check generated code against
 * a version no project will ever install.
 */
const DEPENDENCIES = {
  '@dbos-inc/dbos-sdk': '^4.25.14',
  '@dbos-inc/prisma-datasource': '^4.25.14',
  '@prisma/adapter-pg': '^7.9.1',
  '@prisma/client': '^7.9.1',
  express: '^5.2.1',
  pg: '^8.23.0',
  tsx: '^4.23.12',
  zod: '^4.4.3',
};

const DEV_DEPENDENCIES = {
  '@eslint/js': '^10.0.1',
  '@types/express': '^5.0.6',
  '@types/node': '^24.13.3',
  '@types/pg': '^8.21.0',
  dotenv: '^17.4.2',
  eslint: '^10.8.1',
  'eslint-config-prettier': '^10.1.8',
  prettier: '^3.9.6',
  prisma: '^7.9.1',
  typescript: '^6.0.3',
  'typescript-eslint': '^8.66.0',
  vitest: '^4.1.10',
};

/**
 * `build` is `tsc --noEmit` and nothing else.
 *
 * Codegen would belong in it, and the command-line
 * tool that would run codegen does not exist yet.
 * Shipping a script that fails on a fresh project
 * is worse than shipping a narrower one that
 * works. Today regeneration runs from the mBoss VS
 * Code extension or through the MCP server, and
 * `build` grows its other half when the
 * command-line tool lands.
 */
const SCRIPTS = {
  dev: 'tsx watch --env-file-if-exists=.env src/app/main.ts',
  start: 'tsx src/app/main.ts',
  build: 'tsc --noEmit',
  test: 'vitest run',
  typecheck: 'tsc --noEmit',
  format: 'prettier --write .',
  lint: 'tsc --noEmit && eslint . && prettier --check .',
  generate: 'prisma generate',
  'migrate:deploy': 'prisma migrate deploy',
  postinstall: 'prisma generate',
  deploy: 'railway up',
};

export function packageJson(name: string): string {
  return `${JSON.stringify(
    {
      name,
      version: '0.0.0',
      private: true,
      type: 'module',
      engines: { node: '24.18' },
      scripts: SCRIPTS,
      dependencies: DEPENDENCIES,
      devDependencies: DEV_DEPENDENCIES,
    },
    null,
    2,
  )}
`;
}
