/**
 * The image.
 *
 * Three things here are not obvious and each cost
 * somebody an afternoon somewhere: the openssl
 * package, the schema arriving before the install,
 * and the absence of `--omit=dev`. Each carries
 * its reason in the file itself, because the
 * failure mode of every one of them is a container
 * that builds and then will not start.
 */
export const DOCKERFILE = `FROM node:24.18.0-slim

WORKDIR /app

# Prisma's query engine links against libssl, and
# node:slim does not ship it.
RUN apt-get update \\
  && apt-get install -y --no-install-recommends \\
    openssl ca-certificates \\
  && rm -rf /var/lib/apt/lists/*

# The schema and its config arrive before the
# install, because postinstall runs
# \`prisma generate\` and generate fails outright
# with the config present and the schema absent.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma

# No --omit=dev. prisma and dotenv are development
# dependencies that the entrypoint and the config
# both need, so omitting them breaks container
# start rather than the build.
RUN npm ci

COPY . .

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
`;
