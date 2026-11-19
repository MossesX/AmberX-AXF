/**
 * Gate store adapter (gate-rules@1, framework/spec/GATE.md). The ONE place the gate plugin touches files: its own
 * rule set, lander state and history in the plugin's data folder, and the lander's files in the data folder of the
 * plugin that provides service:axf.merge-queue@1 (config.json, merge-queue.json, land.json, their control files, the
 * run log). A later axf-molly backend replaces this file (and lander.mjs) and nothing else.
 *
 *   createStore({ root?, consoleRoot?, dataDir?, landerDir?, landerCli?, now? }) → store
 *
 * Environment: AXF_GATE_DIR (the plugin's data folder), AXF_GATE_LANDER_DIR (the lander's data folder; else
 * AXF_PUSH_BANNER_DIR, else the merge-queue provider's lifecycle.dataDir under AXF_CONSOLE_ROOT or the repo),
 * AXF_GATE_LANDER_CLI (the lander's CLI; else land/land.mjs in the provider's folder), AXF_GATE_NOW (tests: a fixed
 * clock). Plain Node built-ins only.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gate from '../../../../framework/core/gate-rules.mjs';
import * as dataFiles from '../../../../framework/core/data-files.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const FOLDER = 'gate';
const REPO = resolve(HERE, '../../../..');
const env = (k) => (process.env[k] === undefined || process.env[k] === '' ? '' : process.env[k]);
const CONFIRM_TTL_MS = 5 * 60 * 1000;
const HISTORY_FILE = 'history.jsonl';

// JSON documents through the data layer (framework/core/data-files.mjs): files while local, axf-data rows once cut over
// (postgres part C: land-control.json, merge-queue-control.json); the history journal below stays a local file for now
export const readJson = (f, d) => dataFiles.readJsonSync(f, d);
export function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); dataFiles.writeJsonSync(f, v, 1); }
const readLines = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

/** The console plugin that provides the merge queue (by capability, never by folder name): { dir, dataDir } or null. */
export function landerProvider(root = REPO) {
  const plugins = join(root, 'apps/console-web/plugins');
  if (!existsSync(plugins)) return null;
  for (const d of readdirSync(plugins).sort()) {
    const m = readJson(join(plugins, d, 'plugin.json'), null);
    if (m && Array.isArray(m.provides) && m.provides.includes('service:axf.merge-queue@1')) return { dir: join(plugins, d), dataDir: m.lifecycle?.dataDir || '' };
  }
  return null;
}

export function createStore(opts = {}) {
  const root = opts.root || env('AXF_ROOT') || REPO;
  const consoleRoot = opts.consoleRoot || env('AXF_CONSOLE_ROOT') || root;
  const provider = opts.landerDir && opts.landerCli !== undefined ? null : landerProvider(root);
  const dataDir = opts.dataDir || env('AXF_GATE_DIR') || join(consoleRoot, '.axf-console', 'plugins', FOLDER);
  const landerDir = opts.landerDir || env('AXF_GATE_LANDER_DIR') || env('AXF_PUSH_BANNER_DIR') || (provider?.dataDir ? join(consoleRoot, provider.dataDir) : '');
  const landerCli = opts.landerCli ?? (env('AXF_GATE_LANDER_CLI') || (provider && existsSync(join(provider.dir, 'land/land.mjs')) ? join(provider.dir, 'land/land.mjs') : ''));
  // AXF_GATE_NOW (an ISO time) pins the clock: the parity tests compare the CLI's and the API's answers byte for byte
  const now = opts.now || (env('AXF_GATE_NOW') ? () => new Date(env('AXF_GATE_NOW')) : () => new Date());
  const iso = () => now().toISOString();
  const f = (n) => join(dataDir, n);
  const lf = (n) => (landerDir ? join(landerDir, n) : '');

  const store = {
    backend: 'console-files', dataDir, landerDir, landerCli, now, iso,

    // ---------------------------------------------------------------- the lander's config (merge-queue provider)
    /** The lander's config.json as written (every key kept). */
    landerConfig() { return landerDir ? readJson(lf('config.json'), {}) || {} : {}; },
    /** Change some lander config keys, keeping the rest (the provider's own server writes the same file). */
    patchLanderConfig(patch) {
      if (!landerDir) throw Object.assign(new Error('no lander data folder (no plugin provides service:axf.merge-queue@1)'), { code: 'unavailable' });
      const cur = store.landerConfig();
      const next = { ...cur, ...patch, $axf: cur.$axf || 'push-banner-config@1' };
      writeJson(lf('config.json'), next);
      return next;
    },

    // ---------------------------------------------------------------- the rule set
    /** The rule set; until the first change it is migrated from the lander's config (gate-rules migrate). Reads never write. */
    readRules() {
      const raw = readJson(f('rules.json'), null);
      if (raw && raw.$axf === gate.SET_FRAME) return gate.joinDefaults(raw, { at: iso() }); // a default rule added later (auto-lander) joins a saved set
      return gate.migrate(store.landerConfig(), { at: iso(), by: 'migration' });
    },
    /** Save the rule set (rev + 1) and mirror the keys the cron lander reads. Returns the saved set. */
    writeRules(set, { by = 'console' } = {}) {
      const cur = readJson(f('rules.json'), null);
      const next = gate.normRuleSet({ ...set, rev: Math.max(Number(cur?.rev) || 0, Number(set.rev) || 0) + 1, at: iso(), updatedBy: by }, iso());
      const errs = gate.ruleSetErrors(next);
      if (errs.length) throw Object.assign(new Error(errs.join('; ')), { code: 'invalid' });
      writeJson(f('rules.json'), next);
      store.mirrorRules(next);
      return next;
    },
    /** The rule the lander obeys today: UI Review on/off is the lander's landWaitUi. */
    mirrorRules(set) {
      if (!landerDir) return;
      const ui = set.rules.find((r) => r.id === 'ui-review'); // the gate's rule id, axf-not-plugin:ui-review
      const cfg = store.landerConfig();
      if (ui && (cfg.landWaitUi !== false) !== ui.enabled) store.patchLanderConfig({ landWaitUi: ui.enabled });
    },

    // ---------------------------------------------------------------- the gate's own lander record (mode, pause)
    gateLander() { return readJson(f('lander.json'), {}) || {}; },
    writeGateLander(v) { writeJson(f('lander.json'), { $axf: 'gate-lander@1', ...v, at: iso() }); return store.gateLander(); },

    // ---------------------------------------------------------------- what the lander writes
    queue() { return readJson(lf('merge-queue.json'), { items: [], stack: [], waiting: [], kicked: [], merged: [] }) || {}; },
    queueControl() { return readJson(lf('merge-queue-control.json'), { order: [], removed: {}, kicked: {}, added: [] }) || {}; },
    land() { return readJson(lf('land.json'), { items: [] }) || {}; },
    landControl() { return readJson(lf('land-control.json'), { holds: {}, now: [], after: {} }) || {}; },
    /** The lander's run log (land-runs.jsonl when the lander writes one), oldest first, as auto-lander-run@1. */
    runs() {
      const out = [];
      for (const r of landerDir ? readLines(lf('land-runs.jsonl')) : []) {
        const result = r.outcome === 'landed' || r.outcome === 'merged' ? 'landed' : r.error ? 'error' : !r.endedAt ? 'landing' : r.outcome === 'skipped' ? 'skipped' : 'idle';
        out.push(gate.normRun({ startedAt: r.startedAt, finishedAt: r.endedAt, result, mode: 'serial', reasonText: r.note || r.error || '', landing: r.pr ? { pr: r.pr, build: r.build, branch: r.branch, ci: r.ci?.state || '' } : null, merged: result === 'landed' && r.pr ? [r.pr] : [], ...(r.error ? { error: r.error } : {}) }));
      }
      for (const m of Array.isArray(store.queue().merged) ? store.queue().merged : []) {
        if (m?.pr && m.at) out.push(gate.normRun({ startedAt: m.at, finishedAt: m.at, result: 'landed', mode: 'stack', reasonText: m.title ? `landed through the merge queue: ${m.title}` : 'landed through the merge queue', landing: { pr: m.pr, title: m.title || '' }, merged: [m.pr] }));
      }
      return out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    },
    /** Run the lander's CLI (land.mjs) with its data folder; { ok, code, out, err, json }. Never merges by itself. */
    landerCommand(args) {
      if (!landerCli) return { ok: false, code: 'unavailable', err: 'no lander CLI (no plugin provides service:axf.merge-queue@1 with land/land.mjs)' };
      const r = spawnSync(process.execPath, [landerCli, ...args, '--json'], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, AXF_PUSH_BANNER_DIR: landerDir, AXF_CREW_SAY: process.env.AXF_CREW_SAY || 'off' } });
      const out = (r.stdout || '').trim();
      let json = null; try { json = JSON.parse(out.split('\n').pop() || 'null'); } catch { /* text */ }
      return { ok: r.status === 0, code: r.status === 0 ? '' : 'failed', out: out.slice(-2000), err: (r.stderr || r.error?.message || '').trim().slice(-600), json };
    },

    // ---------------------------------------------------------------- history (append-only JSONL)
    historyFile: f(HISTORY_FILE),
    appendHistory(entry) { mkdirSync(dataDir, { recursive: true }); appendFileSync(f(HISTORY_FILE), `${JSON.stringify(entry)}\n`); return entry; },
    readHistory() { return readLines(f(HISTORY_FILE)); },
    writeHistory(entries) { mkdirSync(dataDir, { recursive: true }); const t = `${f(HISTORY_FILE)}.tmp-${process.pid}`; writeFileSync(t, entries.map((e) => `${JSON.stringify(e)}\n`).join('')); renameSync(t, f(HISTORY_FILE)); },

    // ---------------------------------------------------------------- the plugin's own settings
    settings() { return readJson(f('settings.json'), {}) || {}; },
    writeSettings(v) { writeJson(f('settings.json'), { $axf: 'gate-settings@1', ...v }); return store.settings(); },

    // ---------------------------------------------------------------- confirm tokens (two-step destructive presses)
    /** A one-time token for `op` on `key`, good for five minutes. */
    issueConfirm(op, key) {
      const all = store.confirms(); const token = randomBytes(9).toString('base64url');
      all[token] = { op, key: String(key ?? ''), exp: now().getTime() + CONFIRM_TTL_MS };
      writeJson(f('confirms.json'), all); return token;
    },
    /** True (and the token spent) when `token` was issued for `op` on `key` and has not expired. */
    takeConfirm(op, key, token) {
      const all = store.confirms(); const c = all[String(token || '')];
      if (!c || c.op !== op || c.key !== String(key ?? '') || c.exp < now().getTime()) return false;
      delete all[token]; writeJson(f('confirms.json'), all); return true;
    },
    confirms() { const all = readJson(f('confirms.json'), {}) || {}; const t = now().getTime(); for (const k of Object.keys(all)) if (!(all[k]?.exp > t)) delete all[k]; return all; },
  };
  return store;
}
