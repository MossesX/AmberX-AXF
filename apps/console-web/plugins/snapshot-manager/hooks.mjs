/** Lifecycle hooks (plugin-lifecycle@1) for Snapshot Manager. Everything stays inside ctx.dataDir. */
import { existsSync, mkdirSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  mkdirSync(join(ctx.dataDir, 'snaps'), { recursive: true, mode: 0o700 });
  const f = join(ctx.dataDir, 'settings.json');
  if (!existsSync(f)) {
    writeFileSync(f, JSON.stringify({ $axf: 'snapshot-settings@1', keepDays: 30, maxGb: 5, maxSnapshotMb: 1024, exclude: ['node_modules', '__pycache__', '.cache', '.pnpm-store', '.venv', '.gradle', '.turbo'] }, null, 2));
    chmodSync(f, 0o600);
    ctx.log('seeded settings.json (keep 30 days, cap 5 GB, node_modules and caches skipped)');
  } else ctx.log('kept the existing settings.json');
}

export async function onUninstall(ctx) {
  const d = join(ctx.dataDir, 'snaps');
  const n = existsSync(d) ? readdirSync(d).length : 0;
  ctx.log(`removing ${n} snapshot(s) and the settings; after this, approved changes can't be undone and new batches are refused until a snapshot provider is back`);
}

export async function checks(ctx) {
  return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }];
}
