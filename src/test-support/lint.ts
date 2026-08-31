import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { check, getFileInfo, resolveConfig } from 'prettier';

import { makeTypecheckProject, removeTypecheckProject } from './typecheck.js';

/**
 * The honest substitute for `npm run lint` inside
 * a generated project.
 *
 * Neither a golden nor a type-check reads the
 * files a project's own lint reads most of:
 * `docker-compose.yml`, the README, the
 * conventions, `package.json`, `tsconfig.json`,
 * `eslint.config.mjs`. These two run the real
 * Prettier and ESLint APIs over the emitted set,
 * with the emitted configuration, so "lint passes
 * inside a scaffolded project" is checked rather
 * than assumed.
 *
 * The files are written to a throwaway directory
 * first. Both tools take a path — Prettier decides
 * a parser from it and finds the ignore file
 * beside it, ESLint loads a flat config by
 * importing it — so an in-memory check would be
 * checking a reimplementation of the parts that
 * matter.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */

/**
 * What both runners need of a file. The scaffold's
 * own `ScaffoldFile` carries a mode as well and
 * satisfies this shape, which is why neither
 * runner has to know anything about the scaffold.
 */
export type LintFile = { path: string; contents: string };

/**
 * Writes the set to a throwaway project, hands the
 * directory to `run`, and removes it afterwards
 * whatever happened.
 */
async function withWrittenFiles<T>(
  files: LintFile[],
  run: (projectDir: string) => Promise<T>,
): Promise<T> {
  const project = await makeTypecheckProject();

  try {
    for (const file of files) {
      const path = join(project.projectDir, file.path);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, file.contents, 'utf8');
    }
    return await run(project.projectDir);
  } finally {
    await removeTypecheckProject(project);
  }
}

/**
 * The emitted files Prettier would reformat, by
 * project-relative path.
 *
 * A file with no inferred parser is skipped rather
 * than reported, which is exactly what
 * `prettier --check .` does with the Dockerfile,
 * the entrypoint and `.env`.
 */
export async function prettierProblems(files: LintFile[]): Promise<string[]> {
  return withWrittenFiles(files, async (projectDir) => {
    const ignorePath = files.some((f) => f.path === '.prettierignore')
      ? join(projectDir, '.prettierignore')
      : undefined;
    const problems: string[] = [];

    for (const file of files) {
      const path = join(projectDir, file.path);
      const info = await getFileInfo(path, { ignorePath });
      if (info.ignored || info.inferredParser === null) continue;

      const config = await resolveConfig(path);
      const formatted = await check(file.contents, {
        ...config,
        filepath: path,
      });
      if (!formatted) problems.push(file.path);
    }

    return problems;
  });
}

/**
 * What ESLint says about the emitted set, one
 * string per message.
 *
 * The emitted `eslint.config.mjs` is the config,
 * ignores and all — so a generated directory the
 * project deliberately excludes is excluded here
 * too, rather than being re-listed in a second
 * place that can drift.
 */
export async function eslintProblems(files: LintFile[]): Promise<string[]> {
  return withWrittenFiles(files, async (projectDir) => {
    const eslint = new ESLint({
      cwd: projectDir,
      overrideConfigFile: join(projectDir, 'eslint.config.mjs'),
      // A real project has one obvious root and
      // typescript-eslint finds it. A throwaway
      // one shares a parent with every other
      // throwaway project this process made, and
      // the parser refuses to guess between them.
      overrideConfig: [
        { languageOptions: { parserOptions: { tsconfigRootDir: projectDir } } },
      ],
    });
    const results = await eslint.lintFiles([projectDir]);

    return results.flatMap((result) =>
      result.messages.map(
        (message) =>
          `${relativeTo(projectDir, result.filePath)}:${message.line} ` +
          `${message.ruleId ?? 'parse'} ${message.message}`,
      ),
    );
  });
}

function relativeTo(projectDir: string, path: string): string {
  return path.startsWith(projectDir) ? path.slice(projectDir.length + 1) : path;
}
