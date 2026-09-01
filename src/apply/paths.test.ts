import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MBOSS_DIRNAME,
  conventionsFile,
  mbossDirOf,
  mcpDir,
  skillsDir,
} from './paths.js';

const mbossDir = mbossDirOf(join('/tmp', 'project'));

describe('the scaffolded directories inside .mboss', () => {
  it('put the mcp bundle in one place', () => {
    expect(mcpDir(mbossDir)).toBe(join(mbossDir, 'mcp'));
  });

  it('put the skills slot in one place', () => {
    expect(skillsDir(mbossDir)).toBe(join(mbossDir, 'skills'));
  });

  it('put the code-behind conventions in one place', () => {
    expect(conventionsFile(mbossDir)).toBe(join(mbossDir, 'conventions.md'));
  });

  it('are all inside the control directory', () => {
    for (const path of [
      mcpDir(mbossDir),
      skillsDir(mbossDir),
      conventionsFile(mbossDir),
    ]) {
      expect(path.startsWith(mbossDir)).toBe(true);
      expect(path).toContain(MBOSS_DIRNAME);
    }
  });
});
