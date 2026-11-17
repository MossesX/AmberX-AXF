#!/usr/bin/env node
/**
 * hub-settings-migrate — axHub web's saved settings into the console's hub-console@1 settings, once (s4 of build
 * move-everything-axhub-web-console; rules in framework/core/hub-settings-migration.mjs, spec HUB-CONSOLE.md).
 *
 *   node framework/cli/hub-settings-migrate.mjs [plan]            DRY RUN (the default): what would move, keep, skip, review
 *   node framework/cli/hub-settings-migrate.mjs apply [--force] [--again]
 *                                                                 write the console document and the report; a second run
 *                                                                 is a no-op while the report exists (--again repeats it)
 *   --from <file> --to <file>   run against copies (step 24 runs it against a copy before install.mjs wires it in)
 *   --report <file>             where the one-shot report lives (default <console data>/plugins/hub-admin/settings-migration.json)
 *   --json                      one JSON object
 *
 * Documents: hub-settings@1 at <shared project>/_data/settings/apps/axhub-web.json → …/axf-console.json, where the shared
 * project is /projects/_shared (AXHUB_PROJECTS_DIR/_shared) on the console host; AXF_HUB_SETTINGS_DIR overrides the folder.
 * Nothing is read from a browser and nothing is written anywhere but the target document and the report.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as m from '../core/hub-settings-migration.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);
const cmd = argv.find((a) => !a.startsWith('--') && a !== flag('--from') && a !== flag('--to') && a !== flag('--report')) ?? 'plan';

function settingsDir() {
  if (process.env.AXF_HUB_SETTINGS_DIR) return process.env.AXF_HUB_SETTINGS_DIR;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  return join(projects, '_shared', '_data', 'settings', 'apps');
}
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };

const from = flag('--from') ?? join(settingsDir(), `${m.SOURCE_APP}.json`);
const to = flag('--to') ?? join(settingsDir(), `${m.TARGET_APP}.json`);
const reportFile = flag('--report') ?? join(process.env.AXF_CONSOLE_DATA || join(ROOT, '.axf-console'), 'plugins', 'hub-admin', 'settings-migration.json');
const table = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/hub-console.json'), 'utf8'));

const source = readJson(from);
const target = readJson(to);
const lines = m.planMigration(source, target, table, { force: has('--force') });
const counts = m.summarize(lines);
const previous = readJson(reportFile);

if (cmd === 'plan') {
  if (has('--json')) console.log(JSON.stringify({ ok: true, dryRun: true, from, to, sourceFound: !!source, targetFound: !!target, counts, lines, reportExists: !!previous }));
  else {
    console.log(`Dry run: ${from}${source ? '' : ' (missing: nothing to migrate)'} → ${to}${target ? '' : ' (new)'}`);
    for (const l of lines) console.log(`  ${m.describeLine(l)}`);
    console.log(`${counts.move} move · ${counts.review} review · ${counts.keep} keep · ${counts.skip} skip${previous ? ` · already applied ${previous.at} (apply is a no-op without --again)` : ''}`);
  }
} else if (cmd === 'apply') {
  const r = m.applyMigration(target, lines, { report: previous, again: has('--again'), sourceFile: from, targetFile: to });
  if (!r.already) { writeJson(to, r.target); writeJson(reportFile, r.report); }
  if (has('--json')) console.log(JSON.stringify({ ok: true, dryRun: false, already: r.already, from, to, report: reportFile, counts: r.report.counts }));
  else console.log(r.already ? `Already applied ${r.report.at}; nothing written (use --again to repeat).` : `Applied: ${counts.move + counts.review} key(s) written to ${to}; report ${reportFile}`);
} else {
  console.error(`unknown command ${cmd}; use plan or apply`);
  process.exitCode = 1;
}
