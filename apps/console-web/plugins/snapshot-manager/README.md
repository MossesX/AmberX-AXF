# Snapshot Manager (console plugin)

`ai.amberx.axf.console.snapshot-manager` · built on Opus (Oct 18 2026) · Fable rebuild pending (`snapshot-manager-plugin`).

Snapshots of container files, taken **before every approved change** (Container access calls it for each change batch)
and restorable in one step. **Restore snapshots the current state first**, so an undo can itself be undone.
Settings → Plugins → **Snapshots**: browse by container and date, see what changed since (and a per-file diff),
restore with a confirm step, delete, take one by hand, retention, and the change log (who, what, when, snapshot id).

## Service `axf.snapshots@1`
`take(container, paths, reason, actor, batch, meta)`, `list(container, batch)`, `get(id)`, `diff(id, file?)`,
`restore(id, actor)` → `{before}`, `delete(id)`, `prune()`, `usage()`. Needs `axf.containers@1`.

## Storage and retention
`.axf-console/plugins/snapshot-manager/snaps/<id>/`: `manifest.json` + one `<n>.tar.gz` and `<n>.files.json` per path.
Kept **30 days, capped at 5 GB** (oldest pruned first, checked after every snapshot and hourly), each snapshot capped at
1 GB. Folders named `node_modules`, `__pycache__`, `.cache`, `.pnpm-store`, `.venv`, `.gradle`, `.turbo` are skipped,
and a restore never touches them. All changeable in the settings tab.

## Lifecycle (plugin-lifecycle@1)
```bash
node apps/console-web/plugins/snapshot-manager/install.mjs
node apps/console-web/plugins/snapshot-manager/uninstall.mjs            # data only (backed up)
node apps/console-web/plugins/snapshot-manager/uninstall.mjs --all      # + code and doc lines
python3 apps/console-web/plugins/snapshot-manager/test.py               # self-test with a fake container service
```
