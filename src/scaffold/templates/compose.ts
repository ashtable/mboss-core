/**
 * The app and its database, for local runs.
 *
 * Written so that a later pass can add a service
 * without touching what is already here: one
 * service per top-level key, no anchors and no
 * merge keys. A block that needs an object store
 * or a model server adds a key and nothing else.
 *
 * The database inside Postgres is called `app`
 * whatever the project is called. The compose
 * project name already scopes the containers and
 * the volume, and a fixed database name keeps
 * every connection string the same length as the
 * next project's.
 */
export function dockerCompose(name: string): string {
  return `name: ${name}

services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    # Loopback only. A laptop on shared wifi has
    # no business handing this database out, and
    # \`prisma migrate dev\` run from a shell here
    # still reaches it.
    ports: ['127.0.0.1:5432:5432']
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app -d app']
      interval: 2s
      timeout: 2s
      retries: 15

  app:
    build: .
    depends_on:
      postgres: { condition: service_healthy }
    ports: ['3000:3000']
    # required: false on purpose. A missing
    # required env file fails the whole project at
    # config time, Postgres included, and
    # \`docker compose up -d postgres\` has to work
    # on a fresh checkout.
    env_file:
      - path: ./.env
        required: false
    # Only what compose knows and .env cannot: in
    # here the database answers to a service name,
    # where .env names localhost for a run on this
    # machine.
    environment:
      DATABASE_URL: postgres://app:app@postgres:5432/app
      DBOS_SYSTEM_DATABASE_URL: postgres://app:app@postgres:5432/app
    # The image ships no curl, so the probe is
    # Node's own fetch.
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:3000/healthz').then((r) =>
          process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))
      interval: 3s
      timeout: 3s
      retries: 20

volumes:
  pgdata:
`;
}
