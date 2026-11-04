# expenses-port: Expenses is now an AmberX-AXF app

Build `expenses-port` (Current profile, Opus, agent Reel Rhonda), Nov 4 2026. Branch `claude/expenses-port`.

## What Brett said (verbatim, Nov 4 2026, voice)

> I want to port expenses to AmberX. It's in another repo. ... It should stay its own app in the same repo. ... Make sure it's the right one, the one that has the most entries in it.

## Which repo, and why

**MossesX/Expense** (no "s") is the right one. It is the app live at expenses.amberxai.com.

| | MossesX/Expense | MossesX/Expenses |
|---|---|---|
| Commits | 25 (Oct 16 to Oct 21 2026, PRs #1 to #10) | 4 (Oct 14 to Oct 17) |
| Files | 336 (Next.js app, API, vendored framework, Dockerfile) | 2 (README.md, CLAUDE.md) |
| Live | yes: container `amberx-expenses`, built from `/opt/amberx/expense` (HEAD e75e35b) | no |
| Data | Brett's ledger: **524 entries** (`axf/kv/Brett/expenses.json` on volume `amberx-studio-data`), pay schedule, 9 saves, 2 reports | none |

`Expenses` is an empty stub. Its own CLAUDE.md says "no code yet" and calls itself a possible duplicate of `Expense`. Nothing in it was missing from `Expense`, so nothing from it was ported.

## What was done

1. **Import with history**: `git subtree add --prefix=apps/expenses` of Expense `main` (commit 585ed90f8). All 25 upstream commits are reachable from the merge's second parent (`git log 585ed90f8^2`). The code is identical to what ran: `diff -r` against `/opt/amberx/expense` shows only the added files.
2. **On the framework**:
   - Project manifest `apps/expenses/project.manifest.json` (`expenses`), which validates.
   - Molly lists Expenses in its app list, nav menu, app menu, toolbar and xLayout asset (icon `chart`). The site sends no frame-blocking headers, and its session cookie is `SameSite=lax` on the same site, so sign-in works inside Molly's frame.
   - CLAUDE.md, RULES.md (now eleven manifests) and the Molly README list the app.
3. **Deploy from AmberX-AXF**: `apps/expenses/deploy/install.sh`, details below. It is live now.
4. **API, CLI and MCP**:
   - `/api/expenses/v1`: list, get, add and edit entries; accounts; totals by category, account, month or merchant; CSV and JSON export.
   - CLI: `scripts/expenses-cli.mjs`.
   - Seven console MCP tools: `expenses_list`, `expenses_get`, `expenses_accounts_list`, `expenses_totals_get`, `expenses_export_get` (read-only), `expenses_add` and `expenses_edit`.
5. **Old repo**: MossesX/Expense is left alone and not archived.

## Entry counts before and after (the cut-over)

The script counts every `axf/kv/<user>/expenses.json` on the volume as "users entries hash", from inside both containers:

| When | Old container sees | New container sees |
|---|---|---|
| Before the swap (new runs alongside, no route) | 1 524 cb1a67d38fd2df05 | 1 524 cb1a67d38fd2df05 |
| After the swap | | 1 524 cb1a67d38fd2df05 |

Two later redeploys gave the same result. The SHA-256 of Brett's ledger file is `45fb5a59…6a7be4f86` both before this build and after it. The API was tested against the live ledger with reads only, so no live write was made: 524 entries, spent $21,731.98, income $24,160.00, net $2,428.02.

## How it is deployed now

- Container `amberx-expenses` runs image `expenses-axf:<rev>`, built from AmberX-AXF `apps/expenses`.
- It uses the same Traefik routers as before (`expenses.amberxai.com`) and the same volume `amberx-studio-data`, mounted read-write at `/data`.
- The old image is kept as **`amberx-expenses:pre-axf`** (also still `amberx-expenses:latest`). The old compose file `/opt/amberx/expense/docker-compose.yml` is untouched.
- Cron `/etc/cron.d/amberx-expenses` runs every 5 minutes under `flock /run/amberx-expenses-update.lock`. It pulls `main` into `/opt/expenses-axf` and re-runs the installer when anything outside `_claude/` changed.
  - **Until this PR merges**, `main` has no `apps/expenses`. Each run then stops with "No app at …" and leaves the running container alone.
- The API token is made once at `/opt/expenses-axf/.app/api-token` (root, 600). It is passed to the container as `EXPENSES_API_TOKEN`, and a copy is left at `/opt/axf/.axf-console/expenses-api-token` for the console's MCP tools. It is never stored in the repo.

## How to roll back (one command)

```bash
sudo bash /opt/expenses-axf/apps/expenses/deploy/install.sh --rollback
# before this PR merges the script is only in the build worktree:
sudo bash /root/axf-builds/expenses-port/apps/expenses/deploy/install.sh --rollback
```

The rollback removes the cron and the new container, re-tags `amberx-expenses:pre-axf` as `:latest`, and runs `docker compose -p expenses -f /opt/amberx/expense/docker-compose.yml up -d --no-build`. It never touches the data volume.

Without the script, the same thing by hand: `docker rm -f amberx-expenses && rm -f /etc/cron.d/amberx-expenses && docker tag amberx-expenses:pre-axf amberx-expenses:latest && docker compose -p expenses -f /opt/amberx/expense/docker-compose.yml up -d --no-build`.

`install.sh --status` shows the running image, the kept images and the ledger count.

## Tests

- `npx tsc --noEmit` in apps/expenses: clean.
- `npx tsx scripts/expenses-api.test.mts`: 17 checks. They cover auth, add, edit, filters, totals, accounts, CSV, that the app's kv document shape is kept, and the daily backup.
- `python3 apps/console-web/server/test_mcp_tools.py`: 202 checks, 65 tools.
- `project.mjs validate --all`, `check-theme`, `check-conform`, `check-controls`, `check-toolbars`, `check-xlayout`, `help-coverage --check` and `check-plugin-pages` all pass.
  - `plugins.mjs --check`, `tracker.mjs --check` and `shared-assets.mjs check` fail the same way on main without this branch, so this build didn't cause them.
- Screenshots: phone and desktop of the live sign-in, served by the new container. They are in UI Review → Screenshots, group `expenses-port - Nov 4 6:33 AM`. Molly's new nav item reaches molly.amberxai.com when this PR merges.

## Known gaps (said plainly)

- **The look is not on the AXF theme engines yet.** The app still draws with its vendored `@axf/core` 0.0.25 look (the earlier studio line), not the AXF engines or axHub's appearance@1. A full re-theme of about 90 UI files is its own build. Until then:
  - its 923 theme findings are held to a shrink-only baseline in `framework/spec/conform-baseline.json` (`check-theme.mjs` FROZEN entry), so CI stays green and the count can only go down;
  - the manifest says `framework.relation: "for"`, not `built-on`;
  - it is not in `shared-assets.json`, has no baked `src/axf` and no AXF help or banner.
- **Last save wins between the grid and the API.** The app's grid saves the whole ledger. An entry added through the API while the app is open in a browser can be overwritten by that tab's next save. The daily `expenses.api-backup-YYYYMMDD.json` beside the ledger is the safety net. A fix would make the app's save merge by id.
- **The old deploy paths still exist.**
  - `~/hub/deploy/expense.sh` (on a push to MossesX/Expense) and studioX's deploy both run `docker compose up --build` for the same container name. Either would now fail on the name clash and leave the AXF container running.
  - Nobody pushes to MossesX/Expense any more. Archive it only when Brett says so.
- The console's MCP tools go live with the console's next deploy after merge.
- The old repo's `.github/workflows/deploy.yml` came along inside `apps/expenses/.github`. GitHub never runs workflows outside the repo root, so it is inert.
