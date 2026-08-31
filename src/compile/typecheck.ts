import { join, relative, sep } from 'node:path';

import type { Diagnostic, DiagnosticMessageChain } from 'ts-morph';
import { Project } from 'ts-morph';

/**
 * The `tsc --noEmit` gate over a generated
 * project.
 *
 * This is shipped code rather than a test helper.
 * The extension and the MCP server both regenerate
 * a project's workflows and both have to be able
 * to say whether what they just wrote compiles —
 * against the project's real, installed typings,
 * not against a stub.
 *
 * It checks with ts-morph, which is a runtime
 * dependency, and not with the `typescript`
 * devDependency: this directory is consumed as
 * source by two other repos.
 */

export type TypeProblem = { file: string; line: number; message: string };

export type TypecheckResult =
  | { ok: true; checkedFiles: string[] }
  | { ok: false; checkedFiles: string[]; problems: TypeProblem[] };

/**
 * Type-checks the project rooted at `projectDir`
 * exactly as its own `tsconfig.json` describes it.
 *
 * `checkedFiles` comes back on both branches, so a
 * caller can assert the files it just wrote are
 * actually in the program. A gate whose file list
 * came back empty would otherwise report clean
 * over nothing at all.
 */
export function typecheckProject(projectDir: string): TypecheckResult {
  const configPath = join(projectDir, 'tsconfig.json');

  let project: Project;
  try {
    project = new Project({ tsConfigFilePath: configPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      checkedFiles: [],
      // A configuration error belongs to the
      // config, which is the only file it could be
      // about.
      problems: [{ file: 'tsconfig.json', line: 1, message }],
    };
  }

  const checkedFiles = project
    .getProgram()
    .compilerObject.getRootFileNames()
    .map((file) => projectPath(projectDir, file))
    .sort();

  const problems = project
    .getPreEmitDiagnostics()
    .map((diagnostic) => problemOf(diagnostic, projectDir));

  if (problems.length > 0) return { ok: false, checkedFiles, problems };
  return { ok: true, checkedFiles };
}

/**
 * Project-relative and posix, on every platform,
 * so a caller can compare against the path it
 * asked for.
 */
function projectPath(projectDir: string, file: string): string {
  return relative(projectDir, file).split(sep).join('/');
}

function problemOf(diagnostic: Diagnostic, projectDir: string): TypeProblem {
  const file = diagnostic.getSourceFile();

  return {
    file: file ? projectPath(projectDir, file.getFilePath()) : 'tsconfig.json',
    line: diagnostic.getLineNumber() ?? 1,
    message: flatten(diagnostic.getMessageText()),
  };
}

/**
 * One line, not a nested chain: a caller renders
 * this in a diagnostics list or a terminal, and
 * neither has anywhere to put the tree.
 */
function flatten(text: string | DiagnosticMessageChain): string {
  if (typeof text === 'string') return text;

  const next = text.getNext() ?? [];
  return [text.getMessageText(), ...next.map(flatten)].join(' ');
}
