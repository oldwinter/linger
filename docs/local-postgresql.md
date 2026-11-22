# Local PostgreSQL 17 for development

`pnpm dev` runs the services on your machine against a PostgreSQL 17 database
with the `vector` extension. This page covers only that database and the
problems that come up while running the services from source. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the toolchain versions, the `.env`
template, `pnpm dev`, and the optional LiveKit server.

The default database is
`postgres://simplexai:simplexai@localhost:5432/simplexai_dev`. If you use
another one, set `TEAMHUB_DATABASE_URL` in `.env`; the role, database, and
extension below match the default.

## Option A: only the Compose database

If Docker is available, the Compose `postgres` service already has the
extension:

```bash
docker compose up --detach --wait postgres
```

## Option B: macOS

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
```

Homebrew's superuser is your own OS user, so no `sudo -u postgres` is needed:

```bash
psql -d postgres -c "CREATE ROLE simplexai LOGIN PASSWORD 'simplexai'"
createdb -O simplexai simplexai_dev
psql -d simplexai_dev -c "CREATE EXTENSION IF NOT EXISTS vector"
```

## Option C: Ubuntu or Debian

The packages from [apt.postgresql.org](https://apt.postgresql.org/) ship the
extension:

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" |
  sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update
sudo apt install postgresql-17 postgresql-17-pgvector
```

The `postgres` role uses peer authentication, so run the setup as that OS user:

```bash
sudo -u postgres psql -d postgres -c "CREATE ROLE simplexai LOGIN PASSWORD 'simplexai'"
sudo -u postgres createdb -O simplexai simplexai_dev
sudo -u postgres psql -d simplexai_dev -c "CREATE EXTENSION IF NOT EXISTS vector"
```

## Option D: build from source without root

PostgreSQL and pgvector build without root:

```bash
# PostgreSQL, from its source directory
./configure --prefix="$HOME/.local/pgsql" --without-icu --without-readline --without-zlib
make -j"$(nproc)"
make install

# pgvector, from its source directory
make PG_CONFIG="$HOME/.local/pgsql/bin/pg_config"
make PG_CONFIG="$HOME/.local/pgsql/bin/pg_config" install
```

A source build has no cluster until you create one, and its superuser is the OS
user that ran `initdb`:

```bash
export PATH="$HOME/.local/pgsql/bin:$PATH"
initdb -D "$HOME/.local/pgsql/data"
pg_ctl -D "$HOME/.local/pgsql/data" -l "$HOME/.local/pgsql/server.log" start

psql -d postgres -c "CREATE ROLE simplexai LOGIN PASSWORD 'simplexai'"
createdb -O simplexai simplexai_dev
psql -d simplexai_dev -c "CREATE EXTENSION IF NOT EXISTS vector"
```

`pg_ctl` starts the server on port 5432, which is what the default
`TEAMHUB_DATABASE_URL` expects. Stop it with
`pg_ctl -D "$HOME/.local/pgsql/data" stop`.

## Troubleshooting

| Symptom                                                         | Fix                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `make -C apps/teamhub fmt-check` lists files you did not change | The local `gofmt` is not the version in `apps/teamhub/go.mod`; install that toolchain.            |
| Shell scripts fail with `\r` or `git status` lists every file   | The checkout was created on Windows with CRLF endings; set `core.autocrlf=false` and re-checkout. |
| `livekit-server` warning during `pnpm dev`                      | Voice is off; the app still runs.                                                                 |
| `database "simplexai_dev" does not exist`                       | Create the database; see above.                                                                   |
| `pnpm dev:check` fails on <http://localhost:3000>               | Web waits for TeamHub's `/healthz`; wait a few seconds and run it again.                          |
