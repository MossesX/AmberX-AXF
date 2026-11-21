/**
 * The build watchdog's VPS schedule: /etc/cron.d/axf-build-watchdog from the template deploy/cron/axf-build-watchdog
 * (every minute, flock so passes never overlap; each watch runs only when due). Installing it removes the retired
 * axf-stale-watchdog cron (the row cleaner on its own, now the `rows` watch). install() / uninstall() / status() are called by the plugin's
 * lifecycle hooks (install.mjs, uninstall.mjs) and by the health check's Auto fix.
 *
 * AXF_CRON_DIR points at another folder (tests); AXF_WATCHDOG_CRON=off skips install (a laptop, CI).
 * AXF_CONSOLE_ROOT (else /opt/axf when it exists, else this checkout) is the folder cron runs in.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './providers.mjs';

export const NAME = 'axf-build-watchdog';
/** Crons this one replaces: removed on every install so an old deploy's file never runs beside it. */
export const RETIRED = Object.freeze(['axf-stale-watchdog']);
function retire() { const gone = []; for (const n of RETIRED) { const f = join(cronDir(), n); try { if (existsSync(f)) { rmSync(f, { force: true }); gone.push(n); } } catch { /* not ours to remove here */ } } return gone; }
export const TEMPLATE = join(REPO, 'deploy', 'cron', NAME);
export const cronDir = () => process.env.AXF_CRON_DIR || '/etc/cron.d';
export const cronFile = () => join(cronDir(), NAME);
export const runDir = () => process.env.AXF_CONSOLE_ROOT || (existsSync('/opt/axf/apps/console-web') ? '/opt/axf' : REPO);

/** The cron file's text for a checkout folder (pure but for the template read). */
export const render = (dir = runDir()) => readFileSync(TEMPLATE, 'utf8').replaceAll('__DIR__', dir);

export function status() {
  const f = cronFile();
  const text = existsSync(f) ? readFileSync(f, 'utf8') : '';
  return { file: f, installed: !!text, current: !!text && text === render(), dir: runDir() };
}

export function install({ force = false } = {}) {
  if (process.env.AXF_WATCHDOG_CRON === 'off') return { ok: true, skipped: 'AXF_WATCHDOG_CRON=off' };
  if (!existsSync(cronDir()) && !process.env.AXF_CRON_DIR) return { ok: true, skipped: `no ${cronDir()} here (not the VPS)` };
  const retired = retire();
  const s = status();
  if (s.current && !force) return { ok: true, file: s.file, unchanged: true, retired };
  try { mkdirSync(cronDir(), { recursive: true }); writeFileSync(s.file, render(), { mode: 0o644 }); return { ok: true, file: s.file, installed: true, retired }; }
  catch (e) { return { ok: false, file: s.file, why: String(e.message).slice(0, 200) }; }
}

export function uninstall() {
  const f = cronFile();
  if (!existsSync(f)) return { ok: true, file: f, removed: false };
  try { rmSync(f, { force: true }); return { ok: true, file: f, removed: true }; } catch (e) { return { ok: false, file: f, why: String(e.message).slice(0, 200) }; }
}
