#!/usr/bin/env node
/**
 * Look regression (look-regression@1): record everything the appearance system shows and answers, then diff two
 * records and block on any difference that was not declared expected. Written for the skins-only build
 * (Brett, Nov 9 2026: "remove design packs … it's just skins"): the baseline is recorded on main at tag
 * pre-skins-only-2026-11-09, the rerun on the branch, and the diff decides whether the branch may land.
 *
 *   node framework/spec/look-regression/run.mjs record --out <dir> [--skip-static] [--skip-web] [--skip-checks]
 *        [--apps console-web,molly,…] [--viewports desktop,phone] [--only <check name part>]…
 *        → <dir>/static.json (checks, assets, defaults, themes, control@1, MCP, data hashes), <dir>/web.json + shots/
 *   node framework/spec/look-regression/run.mjs diff <baseline dir> <current dir> [--allow <expected.json>] [--out <report dir>]
 *        [--shot-threshold 0.002]   → report.md + findings.json + diff PNGs; exit 1 on an unexpected difference
 *   node framework/spec/look-regression/run.mjs post <dir> --group "<name>" [--app-filter console-web] [--all]
 *        → the key screenshots (home, settings, appearance; every one with --all) to UI Review → Screenshots (axf shot)
 *
 * Expected differences (--allow) are a JSON file: { "assets": [...], "data": [...], "tokens": [...], "vars": [...],
 * "shots": [...], "mcp": [...], "control": [...], "checks": [...], "errors": [...], "storage": [...], "menus": [...],
 * "settings": [...] } of patterns (`*` matches anything) against the finding keys printed in the report.
 * The web half needs the apps built (apps/<app>/dist) and playwright in apps/console-web (see web.mjs).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, diffPng, encodePng } from './png.mjs';
import { staticRecord } from './static.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
export const FRAME = 'look-regression@1';

const flag = (argv, k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flags = (argv, k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const has = (argv, k) => argv.includes(`--${k}`);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export async function record(argv) {
  const out = resolve(flag(argv, 'out', `/root/axf-builds/_regression/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`));
  mkdirSync(out, { recursive: true });
  const meta = { $axf: FRAME, at: new Date().toISOString(), root: ROOT, commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(), branch: spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() };
  writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 1));
  if (!has(argv, 'skip-static')) {
    console.error('static half…');
    const only = flags(argv, 'only');
    const s = staticRecord(ROOT, { only: only.length ? only : null, skipChecks: has(argv, 'skip-checks') });
    // --skip-checks refreshes the inventory only: the slow check results of an earlier record in the same folder are kept
    if (has(argv, 'skip-checks') && existsSync(join(out, 'static.json'))) { try { s.checks = readJson(join(out, 'static.json')).checks ?? []; } catch { /* nothing to keep */ } }
    writeFileSync(join(out, 'static.json'), JSON.stringify(s, null, 1));
    const failed = s.checks.filter((c) => !c.ok);
    console.error(`static: ${s.checks.length - failed.length}/${s.checks.length} checks pass${failed.length ? ` · failing: ${failed.map((f) => f.name).join(', ')}` : ''}`);
  }
  if (!has(argv, 'skip-web')) {
    console.error('browser half…');
    const { webRecord, APPS, VIEWPORTS } = await import('./web.mjs');
    const apps = flag(argv, 'apps') ? flag(argv, 'apps').split(',') : APPS;
    const viewports = flag(argv, 'viewports') ? flag(argv, 'viewports').split(',') : Object.keys(VIEWPORTS);
    await webRecord(ROOT, out, { apps, viewports, phoneFull: has(argv, 'phone-full') });
  }
  console.log(out);
  return 0;
}

const glob = (pat) => new RegExp(`^${String(pat).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
const allowedBy = (allow, area, key) => (allow[area] ?? []).concat(allow['*'] ?? []).some((p) => glob(p).test(key));

function setDiff(findings, area, keyPrefix, a, b, allow, label = (k) => k) {
  const A = new Set(a), B = new Set(b);
  for (const k of a) if (!B.has(k)) findings.push({ area, key: `${keyPrefix}${k}`, kind: 'removed', detail: label(k), allowed: allowedBy(allow, area, `${keyPrefix}${k}`) });
  for (const k of b) if (!A.has(k)) findings.push({ area, key: `${keyPrefix}${k}`, kind: 'added', detail: label(k), allowed: allowedBy(allow, area, `${keyPrefix}${k}`) });
}
function mapDiff(findings, area, keyPrefix, a, b, allow) {
  setDiff(findings, area, keyPrefix, Object.keys(a ?? {}), Object.keys(b ?? {}), allow);
  for (const k of Object.keys(a ?? {})) if (k in (b ?? {}) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) findings.push({ area, key: `${keyPrefix}${k}`, kind: 'changed', detail: `${JSON.stringify(a[k]).slice(0, 80)} → ${JSON.stringify(b[k]).slice(0, 80)}`, allowed: allowedBy(allow, area, `${keyPrefix}${k}`) });
}

export function diffStatic(base, cur, allow, findings) {
  // checks: a check that passed must still pass; a check that disappeared is reported
  const bc = Object.fromEntries((base.checks ?? []).map((c) => [c.name, c])), cc = Object.fromEntries((cur.checks ?? []).map((c) => [c.name, c]));
  for (const [name, c] of Object.entries(bc)) {
    if (!cc[name]) findings.push({ area: 'checks', key: name, kind: 'removed', detail: 'check not run', allowed: allowedBy(allow, 'checks', name) });
    else if (c.ok && !cc[name].ok) findings.push({ area: 'checks', key: name, kind: 'failed', detail: cc[name].tail.split('\n').slice(-4).join(' | ').slice(0, 400), allowed: allowedBy(allow, 'checks', name) });
    else if (!c.ok && cc[name].ok) findings.push({ area: 'checks', key: name, kind: 'fixed', detail: 'now passes', allowed: true });
  }
  for (const name of Object.keys(cc)) if (!bc[name]) findings.push({ area: 'checks', key: name, kind: 'added', detail: cc[name].ok ? 'passes' : 'FAILS', allowed: cc[name].ok || allowedBy(allow, 'checks', name) });
  // assets by type per copy
  for (const copy of new Set([...Object.keys(base.assets ?? {}), ...Object.keys(cur.assets ?? {})])) {
    const a = base.assets?.[copy] ?? {}, b = cur.assets?.[copy] ?? {};
    for (const type of new Set([...Object.keys(a), ...Object.keys(b)])) setDiff(findings, 'assets', `${copy}/${type}/`, a[type] ?? [], b[type] ?? [], allow);
  }
  mapDiff(findings, 'defaults', 'defaults.', base.defaults, cur.defaults, allow);
  for (const type of new Set([...Object.keys(base.themes ?? {}), ...Object.keys(cur.themes ?? {})])) mapDiff(findings, 'themes', `${type}/`, base.themes?.[type], cur.themes?.[type], allow);
  // control@1: targets, tools, routes, every list's rows (ids + token values)
  mapDiff(findings, 'control', 'target:', base.control?.targets, cur.control?.targets, allow);
  setDiff(findings, 'control', 'tool:', base.control?.tools ?? [], cur.control?.tools ?? [], allow);
  setDiff(findings, 'control', 'route:', base.control?.routes ?? [], cur.control?.routes ?? [], allow);
  for (const t of new Set([...Object.keys(base.control?.lists ?? {}), ...Object.keys(cur.control?.lists ?? {})])) {
    const a = base.control?.lists?.[t], b = cur.control?.lists?.[t];
    if (a?.ok && !b?.ok) findings.push({ area: 'control', key: `list:${t}`, kind: 'failed', detail: b?.error ?? 'no answer', allowed: allowedBy(allow, 'control', `list:${t}`) });
    const rows = (l) => Object.fromEntries((l?.rows ?? []).map((r) => { const { id, overridden, ...rest } = r; return [id, rest]; }));
    mapDiff(findings, 'tokens', `${t}.`, rows(a), rows(b), allow);
  }
  // plugins domain: every plugin's commands and reads, and the tools projected from them
  mapDiff(findings, 'control', 'plugin:', base.control?.plugins, cur.control?.plugins, allow);
  setDiff(findings, 'control', 'plugin-tool:', base.control?.pluginTools ?? [], cur.control?.pluginTools ?? [], allow);
  // MCP: names, annotations, and every read tool still answering
  mapDiff(findings, 'mcp', 'tool:', base.mcp?.tools, cur.mcp?.tools, allow);
  for (const [name, a] of Object.entries(base.mcp?.answers ?? {})) {
    const b = cur.mcp?.answers?.[name];
    if (a.ok && b && !b.ok) findings.push({ area: 'mcp', key: `answer:${name}`, kind: 'failed', detail: (b.error ?? b.head ?? '').slice(0, 200), allowed: allowedBy(allow, 'mcp', `answer:${name}`) });
  }
  if (base.mcp?.error || cur.mcp?.error) findings.push({ area: 'mcp', key: 'inventory', kind: 'failed', detail: (cur.mcp?.error ?? base.mcp?.error).slice(0, 300), allowed: false });
  // data files
  mapDiff(findings, 'data', '', base.data, cur.data, allow);
}

export function diffWeb(base, cur, allow, findings, { baseDir, curDir, reportDir, shotThreshold }) {
  const keys = new Set([...Object.keys(base?.apps ?? {}), ...Object.keys(cur?.apps ?? {})]);
  for (const k of keys) {
    const a = base?.apps?.[k], b = cur?.apps?.[k];
    if (!a || !b || a.error || b.error) { if (!b || b.error) findings.push({ area: 'web', key: k, kind: 'failed', detail: b?.error ?? 'not recorded', allowed: allowedBy(allow, 'web', k) }); continue; }
    const pre = `${k}/`;
    // errors: anything new fails
    for (const area of ['errors', 'consoleErrors']) {
      const A = new Set(a[area] ?? []);
      for (const e of b[area] ?? []) if (!A.has(e)) findings.push({ area: 'errors', key: `${pre}${area}:${e.slice(0, 120)}`, kind: 'added', detail: e, allowed: allowedBy(allow, 'errors', `${pre}${area}:${e}`) });
    }
    const fa = new Set((a.failed ?? []).map((f) => `${f.status} ${f.url}`));
    for (const f of b.failed ?? []) { const key = `${f.status} ${f.url}`; if (!fa.has(key)) findings.push({ area: 'errors', key: `${pre}request:${key}`, kind: 'added', detail: 'failed request', allowed: allowedBy(allow, 'errors', `${pre}request:${key}`) }); }
    // variables
    mapDiff(findings, 'vars', `${pre}`, a.vars?.root, b.vars?.root, allow);
    setDiff(findings, 'vars', `${pre}missing:`, a.vars?.missing ?? [], b.vars?.missing ?? [], allow);
    mapDiff(findings, 'vars', `${pre}html:`, a.vars?.htmlAttrs, b.vars?.htmlAttrs, allow);
    mapDiff(findings, 'storage', pre, a.storage, b.storage, allow);
    if (a.roundTrip?.ok && !b.roundTrip?.ok) findings.push({ area: 'settings', key: `${pre}round-trip`, kind: 'failed', detail: JSON.stringify(b.roundTrip).slice(0, 300), allowed: allowedBy(allow, 'settings', `${pre}round-trip`) });
    if (a.roundTrip?.slot && b.roundTrip?.slot && a.roundTrip.slot !== b.roundTrip.slot) findings.push({ area: 'settings', key: `${pre}round-trip-slot`, kind: 'changed', detail: `${a.roundTrip.slot} → ${b.roundTrip.slot}`, allowed: allowedBy(allow, 'settings', `${pre}round-trip-slot`) });
    // plugins: every plugin still listed and loaded
    const plug = (p) => (Array.isArray(p) ? p.map((x) => x.folder ?? x.id ?? x.name ?? JSON.stringify(x)).sort() : []);
    setDiff(findings, 'plugins', `${pre}`, plug(a.plugins), plug(b.plugins), allow);
    for (const p of Array.isArray(b.plugins) ? b.plugins : []) if (p.error || (p.server && p.server !== 'loaded' && p.server !== 'none')) findings.push({ area: 'plugins', key: `${pre}${p.folder}:load`, kind: 'failed', detail: p.error ?? p.server, allowed: allowedBy(allow, 'plugins', `${pre}${p.folder}:load`) });
    // the console's catalogue of deep-link targets (console_open / console_dialog / console_settings / console_action)
    for (const t of new Set([...Object.keys(a.catalog ?? {}), ...Object.keys(b.catalog ?? {})])) {
      const ids = (c) => (Array.isArray(c?.[t]) ? Object.fromEntries(c[t].map((x) => [x.id, x.title])) : {});
      if (Array.isArray(a.catalog?.[t]) && !Array.isArray(b.catalog?.[t])) findings.push({ area: 'catalog', key: `${pre}${t}`, kind: 'failed', detail: JSON.stringify(b.catalog?.[t]), allowed: allowedBy(allow, 'catalog', `${pre}${t}`) });
      mapDiff(findings, 'catalog', `${pre}${t}:`, ids(a.catalog), ids(b.catalog), allow);
    }
    // menus and settings sections / tabs
    for (const m of new Set([...Object.keys(a.menus ?? {}), ...Object.keys(b.menus ?? {})])) setDiff(findings, 'menus', `${pre}${m}:`, (a.menus?.[m] ?? []).map((l) => l.id), (b.menus?.[m] ?? []).map((l) => l.id), allow);
    const secs = (r) => (r.settings ?? []).flatMap((s) => [s.section, ...(s.tabs ?? []).map((t) => `${s.section}/${t}`)]).filter(Boolean);
    setDiff(findings, 'settings', pre, secs(a), secs(b), allow);
    // screenshots by name
    const A = Object.fromEntries((a.shots ?? []).map((s) => [s.name, s])), B = Object.fromEntries((b.shots ?? []).map((s) => [s.name, s]));
    setDiff(findings, 'shots', pre, Object.keys(A), Object.keys(B), allow);
    for (const name of Object.keys(A)) {
      if (!B[name]) continue;
      const fa = join(baseDir, 'shots', k, A[name].file), fb = join(curDir, 'shots', k, B[name].file);
      if (!existsSync(fa) || !existsSync(fb)) { findings.push({ area: 'shots', key: `${pre}${name}`, kind: 'failed', detail: 'png missing', allowed: false }); continue; }
      let d;
      try { d = diffPng(decodePng(readFileSync(fa)), decodePng(readFileSync(fb)), { masks: [...(A[name].masks ?? []), ...(B[name].masks ?? [])] }); } catch (e) { findings.push({ area: 'shots', key: `${pre}${name}`, kind: 'failed', detail: String(e), allowed: false }); continue; }
      const stateChanged = JSON.stringify([A[name].dialogs, A[name].heads]) !== JSON.stringify([B[name].dialogs, B[name].heads]);
      if (d.ratio > shotThreshold || d.sizeChanged || stateChanged) {
        let diffFile = '';
        if (reportDir && d.diff) { mkdirSync(join(reportDir, 'diffs', k), { recursive: true }); diffFile = join('diffs', k, A[name].file); writeFileSync(join(reportDir, diffFile), encodePng(d.diff)); }
        findings.push({ area: 'shots', key: `${pre}${name}`, kind: 'changed', detail: `${(d.ratio * 100).toFixed(2)}% of pixels${d.sizeChanged ? ', size changed' : ''}${stateChanged ? `, state ${JSON.stringify([A[name].dialogs, A[name].heads])} → ${JSON.stringify([B[name].dialogs, B[name].heads])}` : ''}`, allowed: allowedBy(allow, 'shots', `${pre}${name}`), diff: diffFile, base: fa, current: fb, ratio: d.ratio });
      }
    }
  }
}

export function report(findings, { baseMeta, curMeta }) {
  const unexpected = findings.filter((f) => !f.allowed && f.kind !== 'fixed');
  const lines = [`# Look regression report`, '', `Baseline: ${baseMeta?.commit?.slice(0, 9) ?? '?'} (${baseMeta?.branch ?? '?'}, ${baseMeta?.at ?? '?'})`, `Current: ${curMeta?.commit?.slice(0, 9) ?? '?'} (${curMeta?.branch ?? '?'}, ${curMeta?.at ?? '?'})`, '',
    `**${unexpected.length} unexpected difference(s)** · ${findings.length - unexpected.length} expected or improvements · ${findings.length} total`, ''];
  const byArea = {};
  for (const f of findings) (byArea[f.area] ??= []).push(f);
  for (const [area, list] of Object.entries(byArea).sort()) {
    lines.push(`## ${area} (${list.filter((f) => !f.allowed && f.kind !== 'fixed').length} unexpected / ${list.length})`, '');
    for (const f of list.slice(0, 400)) lines.push(`- ${f.allowed || f.kind === 'fixed' ? 'ok ' : '**!!**'} ${f.kind} \`${f.key}\`${f.detail ? ` — ${String(f.detail).slice(0, 300)}` : ''}${f.diff ? ` (diff: ${f.diff})` : ''}`);
    if (list.length > 400) lines.push(`- … ${list.length - 400} more`);
    lines.push('');
  }
  return { text: lines.join('\n'), unexpected };
}

export async function diff(argv) {
  const [baseDir, curDir] = argv.filter((a) => !a.startsWith('--') && !['diff'].includes(a) && !argv[argv.indexOf(a) - 1]?.startsWith('--')).map((p) => resolve(p));
  if (!baseDir || !curDir) { console.error('usage: run.mjs diff <baseline dir> <current dir> [--allow expected.json] [--out report dir]'); return 2; }
  const allow = flag(argv, 'allow') ? readJson(flag(argv, 'allow')) : {};
  const reportDir = resolve(flag(argv, 'out', join(curDir, 'report')));
  mkdirSync(reportDir, { recursive: true });
  const shotThreshold = Number(flag(argv, 'shot-threshold', '0.002'));
  const load = (d, f) => (existsSync(join(d, f)) ? readJson(join(d, f)) : null);
  const findings = [];
  const bs = load(baseDir, 'static.json'), cs = load(curDir, 'static.json');
  if (bs && cs) diffStatic(bs, cs, allow, findings); else findings.push({ area: 'checks', key: 'static.json', kind: 'failed', detail: `missing in ${!bs ? 'baseline' : 'current'}`, allowed: false });
  const bw = load(baseDir, 'web.json'), cw = load(curDir, 'web.json');
  if (bw && cw) diffWeb(bw, cw, allow, findings, { baseDir, curDir, reportDir, shotThreshold }); else findings.push({ area: 'web', key: 'web.json', kind: 'failed', detail: `missing in ${!bw ? 'baseline' : 'current'}`, allowed: false });
  const { text, unexpected } = report(findings, { baseMeta: load(baseDir, 'meta.json'), curMeta: load(curDir, 'meta.json') });
  writeFileSync(join(reportDir, 'report.md'), text);
  writeFileSync(join(reportDir, 'findings.json'), JSON.stringify({ $axf: FRAME, baseline: baseDir, current: curDir, unexpected: unexpected.length, findings }, null, 1));
  console.log(text.split('\n').slice(0, 8).join('\n'));
  console.log(`report: ${join(reportDir, 'report.md')}`);
  return unexpected.length ? 1 : 0;
}

/** The key screenshots to UI Review → Screenshots (never the approval queue). */
export async function post(argv) {
  const dir = resolve(argv.find((a) => a !== 'post' && !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--')) ?? '');
  const group = flag(argv, 'group', 'look-regression');
  const web = readJson(join(dir, 'web.json'));
  const meta = existsSync(join(dir, 'meta.json')) ? readJson(join(dir, 'meta.json')) : {};
  const onlyApp = flag(argv, 'app-filter');
  const all = has(argv, 'all');
  let n = 0;
  for (const [k, rec] of Object.entries(web.apps)) {
    if (rec.error || !rec.shots) continue;
    const [app, vp] = k.split('/');
    if (onlyApp && app !== onlyApp) continue;
    const pick = rec.shots.filter((s) => all || s.name === 'home' || s.name === 'settings' || /^settings appearance/i.test(s.name) || /^settings plugins$/i.test(s.name));
    for (const s of pick) {
      const args = ['framework/cli/shot.mjs', join(dir, 'shots', k, s.file), '--name', `${app} ${vp}: ${s.name} (${meta.branch ?? ''} ${meta.commit?.slice(0, 7) ?? ''})`, '--app', app, '--screen', s.item ?? s.settings ?? s.name, '--group', group, '--viewport', vp, '--source', 'headless', '--note', `look-regression record ${meta.at ?? ''}`, '--local'];
      if (flag(argv, 'build')) args.push('--build', flag(argv, 'build'));
      const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });
      if (r.status === 0) n += 1; else console.error(`shot failed: ${s.name}: ${(r.stderr || r.stdout).trim().slice(-200)}`);
    }
  }
  console.log(`${n} screenshots posted to UI Review group "${group}"`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = cmd === 'record' ? record : cmd === 'diff' ? diff : cmd === 'post' ? post : null;
  if (!run) { console.error('usage: run.mjs record|diff|post … (see the header)'); process.exit(2); }
  run(rest).then((code) => process.exit(code), (e) => { console.error(e.stack || e.message); process.exit(1); });
}
