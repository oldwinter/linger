# Local installation core

This package owns instance state, the Native service lifecycle, local account
provisioning and Computer enrollment. The installer service
(`apps/linger-installer`) adapts its structured inputs and redacted events;
the core must not import app source or depend on browser/terminal UI.

Keep instance mutations locked and private state owner-only. Never infer real
Room execution from readiness. Do not reset existing accounts or Computer IDs,
stop unrelated processes, pull mutable images, or delete volumes as recovery.
Every installation runs natively from a Linger source checkout; Docker is not
used.

`atomicPrivate` closes and removes its temporary file on failed writes or
syncs as well as failed publication. A failed replacement keeps the previous
private file available, without leaving partial configuration copies behind.

The account file records provisioning history, not current database readiness
or a promise that its saved password is still current. On HTTP 401, the existing
idempotent owner command establishes whether this email owns the deployment and
can recreate a missing owner without resetting a password. Confirm login after
it: a provisioned owner whose password was deliberately changed remains ready
when the owner command succeeded and login still returns 401. This grants no
session and does not replace saved credentials. A failed owner command, other
login errors, or an unprovisioned account whose login fails must not be treated
as a changed password.

Each instance directory holds `user.env` (0600), the only file a person edits:
`COMPOSIO_API_KEY`, `SONIOX_API_KEY`, `XAI_API_KEY` and `TZ`
(`user-environment.ts`). Every mode merges it into the generated
`compose.env` / `native.env` over a developer checkout's `.env` and under the
installer's own values; other names are ignored with a warning, and the file
is created from a template once and never rewritten. The desktop source
package's `.env` is not read. Voice keys are normally saved in the app
(TeamHub); a key in `user.env` overrides it. Whenever the distribution has
voice tools for this computer, Native prepares them and runs LiveKit with
the key pair and ports in the instance's `livekit.env`, with or without a
voice key; without them, or when they fail to prepare, TeamHub gets
`TEAMHUB_VOICE_MEDIA=off` and the install continues. The services' `voice`
setting tracks only the tools, so a key change never restarts them through
it. A native process restarts when its generated environment changes.
Generated native values preserve quoted paths and literal backslashes by
checking their complete dotenv file with the launcher's parser. Multiline,
NUL-containing or otherwise unrepresentable values fail before publishing
the environment file.
Every port the installer chooses (`ports.ts`) must be free on both
127.0.0.1 and ::1 with nothing answering there: `localhost` resolves to ::1
first on macOS, and a program on ::1 alone would answer for a service that
bound 127.0.0.1 without an error. The web static host listens on both.
Creating an instance also reserves other instances' saved LiveKit HTTP and RTC
ports, even while their voice services are stopped. Each
start re-checks a stopped service's ports and moves one another program took
to a free port, persisted in `instance.json` or `livekit.env`, so the service
restarts with the new environment. The web port is the product origin
(`instance.origin`, `WEB_PUBLIC_ORIGIN`). For the desktop's instance
(`externalComputer`) it moves like the others: the desktop follows the origin
the installer reports and keeps its Computer and session. A Computer this
installer enrolled keeps the origin once the owner account exists (or a
database set aside from an older install marks it to be made again), because
its self-update source and a pending enrollment credential name it; there it
moves only before that. A moved port is saved without the checkout an
update rebinds to, which `instance.json` names only once the services serve
from it. The account step sends a password only
after the origin's `/v0/local/identity` proof, and a service that stops on a
taken port names the port, instead of a foreign server's answer or a bare
failure.
Every update or recreate path stops node-services on its own, right before
TeamHub restarts (natively: for a changed configuration) and while TeamHub is
still up, so its graceful shutdown requeues in-flight Agent Runs.

The home is `LINGER_HOME`, else `~/.simplexai` (`home.ts`). Installs from
before the product was renamed Linger convert once in
`legacy-migration.ts`, which the installer runs before it opens the home and
the desktop runs through `installer.js --migrate`. Under each instance's lock
it stops the instance's Computer and native services, renames `SIMPLEX_*`
keys in the generated env files, and gives the instance its
`linger-<name>-<hash>` project name. A stop whose release folder or Computer
executable is gone counts as done, since an upgrade can leave the record
after the files it names are removed. The legacy project name in
`instance.json` marks an instance as not yet converted, so it is written last
and a rerun after a crash converges. A damaged record is skipped. An
instance that fails keeps its legacy names and is returned with its reason;
it does not stop the others or the installer, and the next start tries it
again. `loadInstance` refuses such an instance with an error that says so.
Only something still running keeps an instance unconverted: work its
Computer reports, or a native service that will not stop. A stop that fails
because its program or runtime left with the earlier app (an unreadable
Computer status, a failed idle stop, a recorded PID now owned by another
program, an old gateway's tools) counts as stopped. A Docker-mode record
(`mode` "source" or "release") is never converted or counted as pending:
`loadInstance` refuses it, and its compose project name removes its
containers. The
cache markers `.simplex-files.json` and `.simplex-model-package.json` keep
their names.

Native PostgreSQL runs `initdb` in `native/postgres-data.partial` and moves
it to `native/postgres-data` only once it succeeds, so a killed `initdb`
never leaves a directory that later attempts treat as initialized. A `postgres-data` with
`PG_VERSION` but no `postmaster.opts` (which only a started server writes)
never served a connection, holds no data, and is initialized again.

The desktop's bundled TeamHub binaries (`teamhub-binaries.ts`) count as current
only when their files still match the manifest's sizes and hashes. A missing
or damaged installed file is copied again from the bundle, so Native can use
the verified binaries without downloading Go and compiling from source.

Every Linger release creates TeamHub's schema from the 852 baseline
migration, which refuses a database that already holds one. A database from
the desktop app before the rename has `public.accounts` but no applied 852
row in `goose_db_version`, so it can never migrate (`legacy-database.ts`).
Once the database is up, Native checks for that; for such a database it
stops PostgreSQL, marks `local-account.json` as not provisioned (so private
login/enrollment reads refuse it until the account step confirms the owner in
the replacement database) and
moves `data/agent`, `data/artifacts`, `computer-enrollment.token` and, last,
`native/postgres-data` into `simplex-backup-<UTC time>` in the instance,
deleting nothing. The database moves last so that a run stopped partway
still finds it and finishes the move, into the same folder when nothing
there would be overwritten. It then opens a
fresh cluster and logs where the data went. The desktop finds the newest backup folder
after the job, enrolls its Computer again once (the old Computer ID is
unknown to the fresh database) and shows the folder on its ready screen.

The Computer config's `local_models` section names the verified localmodels
tool, its `LOCALMODELS_STATE` and model base directory for the Daemon's model
library (`localmodels-computer.ts`). A fresh login passes it as
`--localmodels-*` options; it is part of the managed-runtime fingerprint, so an
existing Computer is rebound once on its next connect. A distribution without
the tool writes none. External Computers (the Desktop's) get the same paths as
the `LINGER_LOCALMODELS_*` keys of the installer's instance runtime.

Setup sets the Computer's model source through `localmodels source apply`
(`byok-source.ts`): BYOK after the Runtime is ready, a local model after the
stack is, and a subscription after its Runtime installs, signed in or not.
The local source is set only by a start whose request chose local models
(`setupChoice` or a plan approval); a restart from the saved choice keeps a
source the person switched to on the Models page.
The installer reads `model-source.json` (`readByokEnvironment`) but never
writes it. `restoreLocalModels` (`local-models.ts`) brings back a
local-models setup's stack while its services keep running, such as after
the desktop's quit stopped it, but only while that source is `local` or not
saved yet: a ready stack costs one `setup binding` check, a stopped one gets
its approved plan applied again and the local source set again. Deployments,
that check and the quit-time stop share one lock per home
(`withLocalModelsLock`); the check waits up to 180 s for it, past the stop's
150 s hard exit, then asks to try again.

`runProcess` decodes stdout and stderr as separate UTF-8 streams before
capture and output callbacks, preserving characters split across pipe reads.

Each native service runs under a detached supervisor
(`native-process-worker.mjs`) whose record holds its PID, birth and an
unguessable lease. POSIX finds the service's processes by process group and
the lease in their environment. Windows has neither: the lease is in the
supervisor's command line (its job file name) and the tree follows parent
links (`windowsLeaseTree`), which break when a parent dies first. So on
Windows a stop ends one snapshot of the tree leaves first and the supervisor
last; a supervisor with nothing under it counts as stopped (the PowerShell
of its own process listing does not count as its service); a program file
starts as `source-native.mjs`'s direct child, not through cmd.exe, so it ends
with its supervisor. Before the services start and after a stop, the
installer ends what an earlier run lost track of (`reclaimNativeOrphans`): a
supervisor whose job file is in this instance's process directory under a
lease no serving record holds, and a process on one of this instance's
ports whose command line runs from this installation's folders but belongs
to no recorded service, with its wrappers up to its supervisor. Never by a
program name alone, and never the installer or what started it. Readiness on
Windows also needs each port's listener inside that service's tree: an
earlier release's TeamHub or web still on the port would otherwise pass the
health check for a service that could not bind, and a port held by another
program fails the start after 15 seconds instead of at the deadline.

On POSIX, a start that finds the recorded supervisor gone but processes
still carrying its lease (the app was killed with it) ends them as a stop
does and starts the service again. A live recorded PID or process group
without the lease proves nothing and is refused, never signalled.
On macOS every identity check reads `ps` start times in the C locale.
Linger 0.1.2 recorded them in the locale it ran in; such a record is
converted once to the C-locale birth when `ps` in the installer's own
locale still prints the recorded birth for the live leader holding the
lease, and is otherwise left as it is. A start
that fails before its record is kept ends what it launched: by the lease,
or, when the lease cannot be proved, by the group of the supervisor it has
not reaped yet, whose PID cannot belong to another program. Before the
services start, `reclaimNativeOrphans` also ends, on POSIX, a supervisor
whose command line names a job file in this instance's process directory
under a lease no record holds, once its environment proves that lease; an
attempt that failed or was killed before keeping a record would otherwise
leave PostgreSQL holding `postmaster.pid` against every retry.

Native runtime and localmodels kit verification (`native-runtime.ts` and
`localmodels-tool.ts`) stop assigning files on the first mismatch and wait
for every active verification worker to finish before reporting failure.
Recovery moves or removes an invalid runtime or kit only after those
workers have released their file handles.

Every download offered by both a global host and a mainland-China mirror
goes through `downloadInRegion` (`region.ts`), which tries the home's
download region first and never drops a source; the region is
`SIMPLEX_REGION`, else `<home>/runtime/region.json` (24 hours), else a
best-of-three npm registry probe (up to 1 MiB per round, fastest wins). When
the preferred region fails or transfers slowly while a mirror in the other
region proves faster, the transfer resumes there and rewrites the file. The
probe is shared per home, but cancellation belongs to each caller: one setup
leaving does not cancel another, and the last waiter leaving aborts the probe
so a later caller can retry. Even a cached region respects caller cancellation.
The resolved region reaches every `localmodels` child and native service as
`SIMPLEX_REGION`. The contract is in `scripts/installs/README.md`.

Verified downloads stop reading on explicit cancellation even when a response
body ignores the fetch signal. They retain the caller's abort reason, cancel
the reader and keep only resumable partial bytes; cancellation never waits
for the idle timeout or moves on to another mirror.
Rebuilding the checksum of a saved resumable partial also uses the caller's
signal, so cancellation stops local reads before another request starts and
leaves the partial file intact for the next attempt.

Move a freshly downloaded or unpacked file or folder into place with
`renameRetrying` from `fs-retry.ts`: on Windows antivirus and indexing hold
new files for a moment, and a plain rename then fails with EPERM.
Cancellation is checked before every rename attempt, including after a
retry wait, so a cancelled installation cannot publish the waiting file.

Setting `LINGER_LOCALMODELS_DEV_PYTHON` and `LINGER_LOCALMODELS_DEV_MODULE_DIR`
to absolute paths runs a local `localmodels` checkout instead of fetching the
published kit, and `LOCALMODELS_DEBUG` (`simulate` or `tiny`, or
`~/.config/localmodels/debug.json`) passes straight through to `localmodels`.

Run `pnpm --filter @linger/local-installation check` (`make check-packages`
runs it too); `make check-installer` runs its consumer, the installer, and
applies to changes that affect its public behavior.
