#!/usr/bin/env node
/**
 * axf shot: save a screenshot to the console's UI Review → Screenshots tab (ui-screenshot@1), NOT the approve / reject
 * queue. For check sessions, live captures, PR before/after and anything else that isn't a planned UI for review.
 *
 *   node framework/cli/shot.mjs <file> [<file>…] --title "…" --app Breakroom --screen /breakroom --source check --session <id>
 *        [--viewport phone|desktop] [--pair <id> --side before|after] [--note "…"] [--build B] [--pr N] [--console | --local]
 *        [--group "<name>"]   the named, timestamped group (same name today = same group; none = "<session> - <YYYY-MM-DD HH:mm>")
 *   node framework/cli/shot.mjs list | groups | group … | move … | promote <id> | migrate | paths   (see the plugin's shots.mjs)
 *
 * Posts to the running console when AXF_CONSOLE_URL + AXF_TOKEN are set (else writes this checkout's data folder).
 * The handler is found by capability (a console plugin providing service:ui-screenshots@1 with shots.mjs), never by folder.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The plugin folder that provides service:ui-screenshots@1 and ships shots.mjs, or null. */
export function findShots(root = ROOT) {
  const plugins = join(root, 'apps/console-web/plugins');
  if (!existsSync(plugins)) return null;
  for (const n of readdirSync(plugins).sort()) {
    const d = join(plugins, n);
    try { if (JSON.parse(readFileSync(join(d, 'plugin.json'), 'utf8')).provides?.includes('service:ui-screenshots@1') && existsSync(join(d, 'shots.mjs'))) return d; } catch { /* not a plugin */ }
  }
  return null;
}

export async function main(argv = process.argv.slice(2)) {
  const owner = findShots();
  if (!owner) { console.error('shot: no console plugin provides ui-screenshots@1 here (UI Review removed?); nothing saved'); process.exitCode = 1; return; }
  const mod = await import(pathToFileURL(join(owner, 'shots.mjs')).href);
  await mod.main(argv);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`shot: ${e.message}`); process.exit(2); });
}
