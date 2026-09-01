/**
 * What the container runs.
 *
 * Migrations run here rather than in the image
 * build: the database exists only at run time, and
 * a build step that needed one could not be
 * reproduced without it.
 *
 * The exec line names the local binary rather than
 * `npx`. The process runs on tsx, and a start
 * command that could quietly reach for the
 * registry instead is a trap the first time a
 * container starts on a machine with no network.
 */
export const ENTRYPOINT_SH = `#!/bin/sh
# Migrations run at container start, not at build
# time: the database exists only at run time, and
# a build that needed one could not be reproduced
# without it.
set -e
npx prisma migrate deploy
exec ./node_modules/.bin/tsx src/app/main.ts
`;

/** Executable. A container that starts with
 *  "permission denied" and no other output is a
 *  bad first ten minutes. */
export const ENTRYPOINT_MODE = 0o755;
