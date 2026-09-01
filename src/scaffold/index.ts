/**
 * Creating a new mBoss project.
 *
 * Nothing here imports the runtime tree under
 * `app/` or the registry seed under `workflows/`.
 * Those are real, type-checked source in this
 * repository and they are *read* — with
 * `readFileSync`, resolved from
 * `import.meta.dirname` — so that express, the
 * DBOS SDK and a Prisma client stay out of the
 * import graph of a library the cloud services
 * nest as source. A test enforces it.
 *
 * One consequence worth knowing about anywhere
 * this library is bundled rather than nested:
 * `src/scaffold/app/**` and
 * `src/scaffold/workflows/index.ts` have to travel
 * with the bundle as assets, because they are read
 * at run time rather than compiled in.
 */
export {
  ProjectNameSchema,
  SCAFFOLD_DIRS,
  scaffoldFiles,
  type ScaffoldFile,
  type ScaffoldOptions,
} from './files.js';
export { scaffoldProject } from './scaffold.js';
