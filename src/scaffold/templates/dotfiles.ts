/**
 * The small configuration files a project needs
 * before anything else works.
 *
 * They are strings rather than checked-in files
 * because two of them would change this repo's own
 * behaviour if they sat on disk here: a real
 * `.gitignore` under `fixtures/` hides the goldens
 * beside it, and a real `.prettierignore` changes
 * what this repo formats.
 */

/**
 * Exactly five `.mboss/` entries are ignored, and
 * they are the five that are derived or transient.
 * Everything else under `.mboss/` — the workflow
 * documents, the conventions, the vendored bundle
 * slots — is the project's own source and is
 * committed.
 *
 * This file is also the deploy manifest: Railway
 * honours it when it uploads. That is why `.env`
 * is here and why the README says to set the
 * variables on the platform instead.
 */
export const GITIGNORE = `node_modules/
coverage/
*.tsbuildinfo
.DS_Store
.env

# Derived or transient; everything else under
# .mboss/ is the project's own source.
.mboss/proposals/
.mboss/history/
.mboss/manifest.json
.mboss/state.json
.mboss/.lock
`;

export const DOCKERIGNORE = `# The image installs its own dependencies and
# runs its own migrations at start, so the build
# context carries source and nothing else.
node_modules
coverage
.git
.env
*.tsbuildinfo
.DS_Store
`;

export const NVMRC = `24.18
`;

export const PRETTIERRC_JSON =
  '{ "singleQuote": true, "semi": true, "printWidth": 80 }\n';

export const PRETTIERIGNORE = `node_modules
coverage

# Compiler-owned and compared byte for byte. A
# reformat here would make the next generation
# produce a diff that is not a change.
src/workflows
`;

/**
 * The four-line flat config the house uses, with
 * one addition: `src/workflows` is ignored.
 *
 * That directory is compiler-owned. Most of what
 * the recommended set objects to there is a step
 * output bound to a name nothing later reads; a
 * generated schedule handler taking a context it
 * does not use is one message of the set, not the
 * whole of it. Nobody is allowed to edit those
 * files to silence either. `tsconfig.json` still
 * includes them, so they are type-checked anyway.
 */
export const ESLINT_CONFIG_MJS = `import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// src/workflows is compiler-owned. A step whose
// output nothing reads is still bound to a name,
// and a schedule handler takes a context it does
// not use — both errors under the recommended
// set, in files nobody can edit to silence them.
// The bindings are most of it. They are still
// type-checked.
const ignores = ['node_modules/**', 'coverage/**', 'src/workflows/**'];

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier, // last — turns off rules that fight Prettier
);
`;

export const VITEST_CONFIG_TS = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests sit beside what they test: the runtime
    // under src/app, your handlers under lib.
    include: ['src/**/*.test.ts', 'lib/**/*.test.ts'],
  },
});
`;

/**
 * The agent's view of this project.
 *
 * `type` is written out rather than inferred from
 * `command`: the documentation marks it required,
 * and an inference is not something to depend on
 * for a file a person will only ever look at when
 * it has already failed.
 *
 * Written out as text rather than built from an
 * object: Prettier keeps a short array on one line
 * and `JSON.stringify` always breaks it.
 */
export const MCP_JSON = `{
  "mcpServers": {
    "mboss": {
      "type": "stdio",
      "command": "node",
      "args": ["\${CLAUDE_PROJECT_DIR}/.mboss/mcp/server.js"]
    }
  }
}
`;

/**
 * What sits in the bundle slot until a consumer
 * fills it.
 *
 * `.mcp.json` registers a server file this library
 * cannot produce — those bytes are built in the
 * MCP server's own repository and shipped inside
 * the VS Code extension. Without this note a fresh
 * project hands its owner an agent configuration
 * that fails on first connect with nothing to read
 * about why.
 */
export const MCP_README_MD = `# The mBoss MCP server goes here

\`.mcp.json\` in the project root registers an MCP server at
\`.mboss/mcp/server.js\`. That file is not here yet, and until it is the
server will not connect — a coding agent reports it as failed rather than
as missing, which is a confusing way to find out.

The bundle is built and shipped by the mBoss VS Code extension. Install the
extension and reopen this project, or copy \`server.js\` and \`VERSION\` here
out of an mBoss release.

The two skill slots — \`.mboss/skills/mboss/\` and \`.claude/skills/mboss/\` —
are filled from the same place and are empty for the same reason.
`;
