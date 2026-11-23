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

## Option E: Windows

The EDB binaries from the
[Windows downloads](https://www.postgresql.org/download/windows/) work, with two
differences from the options above.

**Keep the installation directory and the data directory under a path with
ASCII characters only.** The programs hand their own directory to the backend,
and under a non-ASCII path `initdb` stops on the first file it reads with

```
invalid byte sequence for encoding "UTF8": 0xbc
```

so `C:\Users\you\Desktop\Büro\pgsql` fails where `C:\pgsql` succeeds. Unpack the
`pgsql` directory of the EDB zip to `C:\pgsql` and create the cluster in
`C:\pgdata`.

The EDB zip ships no `vector` extension, and its programs need the Visual C++
runtime, which the installer adds and the zip does not. Build the extension with
an x64 Native Tools Command Prompt for Visual Studio, which supplies both:

```bat
nmake /F Makefile.win PG_CONFIG=C:\pgsql\bin\pg_config.exe
nmake /F Makefile.win install PG_CONFIG=C:\pgsql\bin\pg_config.exe
```

Then create the cluster and the database:

```bat
C:\pgsql\bin\initdb.exe -D C:\pgdata -U postgres --encoding=UTF8 --locale=C
C:\pgsql\bin\pg_ctl.exe -D C:\pgdata -l C:\pgdata\server.log start
C:\pgsql\bin\psql.exe -U postgres -d postgres -c "CREATE ROLE simplexai LOGIN PASSWORD 'simplexai'"
C:\pgsql\bin\createdb.exe -U postgres -O simplexai simplexai_dev
C:\pgsql\bin\psql.exe -U postgres -d simplexai_dev -c "CREATE EXTENSION IF NOT EXISTS vector"
```

If `pg_ctl` reports that it cannot open its log file, run the server in a second
window and leave it open: `C:\pgsql\bin\postgres.exe -D C:\pgdata`.

`pnpm dev` needs `sh` and `make`, and a plain Windows checkout has neither. Use
the Windows launcher, which runs the same steps in Node — migrate, local owner,
TeamHub, Node Services, LiveKit, then Web once TeamHub answers — and stops
everything on Ctrl+C:

```powershell
pnpm dev:windows
```

PowerShell runs `pnpm.ps1` rather than the `.cmd` shim, and the default
execution policy refuses that script. Call `pnpm.cmd dev:windows`, or allow
scripts in this window only with `Set-ExecutionPolicy -Scope Process Bypass`.

The first visit reaches `/login?reason=session-expired` because no session
cookie exists yet, and the login page labels that empty session "Your session
has expired". Sign in with the owner account the launcher just created. A
first run prints `Owner password: ... (shown once)`; afterwards the password
lives in `.linger-runtime/local-owner.json`. A browser that still holds a
session cookie from another checkout of this code on the same host signs out
with `POST /v0/auth/logout`, or clears the site's cookies, before signing in
again.

### Connecting this computer

After sign-in the app asks to connect the computer it runs on. That page gives
`irm '<origin>/install/linger-computer.ps1' | iex`, and Node Services answers
it from a Computer release: `release.json`, the installer templates, and the
archives under `files/`. A checkout ships none, so every `/install/` path
answers 503 with `This Agent Service image ships no Computer release
(release.json is missing).` Build one once:

```powershell
pnpm computer:release:windows
```

That writes `.linger-runtime/computer-release` (ignored by Git, about 90 MB),
builds the daemon and CLI for `win32-x64`, and renders both installers. Restart
`pnpm dev:windows`; the launcher prints `Computer installers are served from
...` when it finds a release. The `irm` line then returns the script.
To serve a release from another directory, set `COMPUTER_RELEASE_DIR` in
`.env` or the shell. The shell takes precedence, and relative paths are
resolved from the checkout root. Place the built release in that directory
before restarting.

The installer templates are declared LF in `.gitattributes`. A working tree
still holds whatever ending it was written with, so the Agent Service also
normalizes the endings when it reads the templates, which keeps the marker
lines whole on every checkout and the bash installer it produces LF.

## Troubleshooting

| Symptom                                                         | Fix                                                                                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make -C apps/teamhub fmt-check` lists files you did not change | The local `gofmt` is not the version in `apps/teamhub/go.mod`; install that toolchain.                                                                                |
| Shell scripts fail with `\r` or `git status` lists every file   | The checkout was created on Windows with CRLF endings; set `core.autocrlf=false` and re-checkout.                                                                     |
| `livekit-server` warning during `pnpm dev`                      | Voice is off; the app still runs.                                                                                                                                     |
| `database "simplexai_dev" does not exist`                       | Create the database; see above.                                                                                                                                       |
| `pnpm dev:check` fails on <http://localhost:3000>               | Web waits for TeamHub's `/healthz`; wait a few seconds and run it again.                                                                                              |
| `initdb` fails with `invalid byte sequence ... 0xbc` on Windows | The PostgreSQL installation or data directory is not pure ASCII; move it; see Option E.                                                                               |
| `pnpm dev` fails with `sh: not found` or `make: not found`      | Windows has neither; run `pnpm dev:windows`; see Option E.                                                                                                            |
| `pnpm.ps1` cannot be loaded because running scripts is disabled | PowerShell resolves `pnpm.ps1` before the `.cmd` shim; call `pnpm.cmd dev:windows`, or allow scripts in this window with `Set-ExecutionPolicy -Scope Process Bypass`. |
| First page says `Your session has expired`                      | No session cookie yet, or a stale one from another checkout on this host: sign in with `.linger-runtime/local-owner.json`, or `POST /v0/auth/logout` first.           |
| `/install/linger-computer.ps1` says the image ships no release  | The checkout has no Computer release; run `pnpm computer:release:windows`, then restart `pnpm dev:windows`.                                                           |
