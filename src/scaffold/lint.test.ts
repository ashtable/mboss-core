import { describe, expect, it } from 'vitest';

import { eslintProblems, prettierProblems } from '../test-support/lint.js';

import { scaffoldFiles } from './files.js';

/**
 * `npm run lint`, inside a project the scaffold
 * made.
 *
 * This is the half of that command no golden and
 * no type-check reaches: the compose file, the
 * README, the conventions, `package.json`,
 * `tsconfig.json` and the two configuration
 * modules are all read by Prettier and by ESLint
 * and by nothing else here. A project whose very
 * first `npm run lint` failed would be a poor
 * advertisement for a tool whose promise is that
 * the boring parts are handled.
 */

const FILES = scaffoldFiles({
  name: 'my_app',
  linkKeys: `k1:${'ab'.repeat(32)}`,
  eventsSecret: 'test-events-secret',
});

describe('a freshly scaffolded project', () => {
  it('is already formatted the way its own Prettier wants', async () => {
    expect(await prettierProblems(FILES)).toEqual([]);
  }, 30_000);

  it('passes its own ESLint, config and ignores and all', async () => {
    expect(await eslintProblems(FILES)).toEqual([]);
  }, 60_000);
});
