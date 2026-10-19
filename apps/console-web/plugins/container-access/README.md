# Container access (console plugin)

`ai.amberx.axf.console.container-access` · built on Opus (Oct 18 2026).

The **master switch** for reaching other containers on the VPS. It is the only code in the console that talks to
Docker, and it does so through a **locked-down socket proxy** (`deploy/haproxy.cfg`): list/inspect containers, the
archive API (read, stat, write files), exec and restart. Everything else (create, remove, images, volumes, networks…)
gets a 403. Uninstall this plugin and nothing in the console can touch another container.

## Rules (enforced on the server)
- **Protected, locked:** Coolify, Traefik/coolify-proxy, the console itself, the proxy, databases (Postgres, MySQL/MariaDB,
  Redis, Mongo and similar). Nothing reads, writes or runs in them. Only the terminal can open one, after an extra confirm.
  Add your own patterns in Settings → Plugins → Container access; built-ins can't be removed.
- **Reach:** every other container (default), or only the ones you list.
- **Agents never change anything directly.** Their changes become a **change batch** (`change-batch@1`): you approve it
  (or untick items), Snapshot Manager (`axf.snapshots@1`) takes a snapshot first, then the items run in order. Without
  Snapshot Manager, nothing is written. A file that changed since it was proposed is refused.
- **Audit log** of every write, delete, command, restart, redeploy, restore, terminal session and settings change.

## Known limit: the proxy doesn't know container names

The Docker proxy allows exec and file uploads on **any** container id; the protected list (Coolify, Traefik, the console,
the proxy, databases) is enforced in this plugin's Python code only. Anything that runs code inside the console
container (the terminal's Console or Claude Code tab, or a bug in any plugin) can reach the proxy directly, and an exec
in Coolify (which holds the Docker socket) is root on the host. Treat the console as host-root equivalent while this
plugin is installed. Hardening option: a small filtering proxy that resolves each id to its name and refuses protected
containers (not built).

Also enforced (after an independent review, Oct 18 2026): a file over 20 MB can't be replaced through a batch (its
change couldn't be checked); changes the card can't fully show (diff cut short, binary or very large) need an explicit
"accept what I can't see"; a command needs folders to snapshot (never the whole filesystem); undo only on a finished
batch and never while one is applying.

## Service `axf.containers@1`
`status()`, `list()`, `resolve(name)`, `workdir(name)`, `stat`, `read_file`, `list_dir`, `search` (literal grep, skips
node_modules/.git), `write_file`, `delete_file`, `exec`, `restart`, `redeploy` (Coolify API for Coolify apps),
`archive_open` / `archive_restore` (Snapshot Manager), `tty` (terminal), `audit()`, `create_batch`, `get_batch`,
`list_batches`, `approve_batch` / `approve_stream` (SSE), `reject_batch`, `undo_batch`, `public_batch`.
Every call names an actor `{kind: user|agent|plugin, id, name}`.

## On the VPS
`deploy/install-console.sh` runs `deploy/host.sh up` (starts `axf-docker-proxy` on a private network, passes
`AXF_DOCKER_PROXY` to the console) and `attach`. Check with `docker ps` and the console's systems check. Sidecars are
labelled `axf.plugin=container-access`; once this folder is gone the next install run removes them.

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/container-access/` (`settings.json`, `audit.jsonl`, `batches/`).
```bash
node apps/console-web/plugins/container-access/install.mjs
node apps/console-web/plugins/container-access/uninstall.mjs            # data only (backed up)
node apps/console-web/plugins/container-access/uninstall.mjs --all      # + code and marked lines
python3 apps/console-web/plugins/container-access/test.py               # self-test against a fake Docker API
```
