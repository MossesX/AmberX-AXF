#!/usr/bin/env node
/**
 * Reference links runner + CLI (ref@1, framework/core/engines/refs.mjs). The server part (server/__init__.py) and the
 * CLI share it: it knows the targets a checkout has on disk (every build in the builds store with its declared
 * touches and PR, every console plugin) and takes the rest (the open console's screens, dialogs, settings and
 * actions, agents, UI Review items) from the caller.
 *
 *   node refs.mjs run                              one request on stdin ({op: targets|find|resolve, text?, touches?, query?, extra?}) → JSON
 *   node refs.mjs find "<text>" [--touches a,b]    the references in a line of text (this checkout's builds + plugins)
 *   node refs.mjs resolve <ref or words>           one ref: id (settings.terminal, build:<id>, #12, PR 281) or a few words
 *   node refs.mjs targets                          every target this checkout knows
 *   node refs.mjs open <ref> [--how open|window|review|build] [--to recent|all|<client>]
 *        → Brett's open console opens it and highlights it (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN)
 *   --json
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 4 not found.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRefs, normalizeRefTarget, refIndex, refTargetFromBuild, resolveRef } from '../../../../framework/core/engines/refs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.AXF_REPO_ROOT || resolve(HERE, '../../../..'));
const PLUGINS = resolve(HERE, '..');
export const FOLDER = 'ref-links';
const HOWS = ['open', 'window', 'review', 'build', 'copy'];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Builds-store builds (not archived) → targets, plus a PR target per build that has one. */
export function buildTargets(root = ROOT) {
  const store = readJson(join(root, '_claude', 'builds', 'store.json'));
  const out = [];
  for (const b of store?.builds ?? []) {
    if (!b || b.status === 'archived' || b.hidden) continue;
    const t = refTargetFromBuild(b);
    if (!t) continue;
    out.push({ ...t, focus: { kind: 'action', spec: 'builds.open' } });
    const n = String(b.pr ?? '').match(/(\d+)\s*$/)?.[1];
    if (n) out.push(normalizeRefTarget({ id: `pr:${n}`, kind: 'pr', label: `PR #${n}`, detail: `Pull request · ${b.title || b.id}`, url: /^https?:/.test(String(b.pr)) ? String(b.pr) : '', icon: 'branch' }));
  }
  return out.filter(Boolean);
}

/** Every console plugin by its name and folder. */
export function pluginTargets(dir = PLUGINS) {
  const out = [];
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name); } catch { return out; }
  for (const folder of names) {
    const m = readJson(join(dir, folder, 'plugin.json'));
    if (!m) continue;
    const t = normalizeRefTarget({ id: `plugin:${folder}`, kind: 'plugin', label: m.name || folder, aliases: [folder], detail: 'Plugin', icon: 'package', focus: { kind: 'action', spec: `plugin-manager.open:${folder}` } });
    if (t) out.push(t);
  }
  return out;
}

/** A console catalog item (console-catalog@1, from console-commands@1 list) → a target. */
export function catalogTarget(it) {
  if (!it || typeof it !== 'object') return null;
  const kind = { screen: 'screen', dialog: 'dialog', settings: 'settings', action: 'action' }[it.kind];
  if (!kind) return null;
  return normalizeRefTarget({ id: `${kind}:${it.id}`, kind, label: kind === 'settings' ? String(it.label ?? '').replace(/\s+settings$/i, '') + ' settings' : it.label, aliases: kind === 'settings' ? [String(it.label ?? '').replace(/\s+settings$/i, '')] : [], detail: it.detail, icon: it.icon });
}

export function targets(extra = []) {
  return [...(Array.isArray(extra) ? extra.map((e) => normalizeRefTarget(e) ?? catalogTarget(e)).filter(Boolean) : []), ...buildTargets(), ...pluginTargets()];
}

/** One request → the answer. */
export function run(req = {}) {
  const all = targets(req.extra);
  if (req.op === 'targets') return { ok: true, $axf: 'ref@1', targets: all };
  const index = refIndex(all);
  if (req.op === 'find') {
    const text = String(req.text ?? '');
    if (!text.trim()) return { ok: false, code: 'validation', message: 'text is needed' };
    const touches = Array.isArray(req.touches) ? req.touches.map(String) : typeof req.touches === 'string' ? req.touches.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const r = findRefs(text, index, { explicit: touches });
    return { ok: true, ...r, targets: r.refs.map((id) => index.byId.get(id)).filter(Boolean) };
  }
  if (req.op === 'resolve') {
    const q = String(req.query ?? req.ref ?? '');
    if (!q.trim()) return { ok: false, code: 'validation', message: 'ref is needed (an id like settings.terminal, build:<id>, PR 281, or a few words)' };
    const r = resolveRef(index, q);
    if (!r.target) return { ok: false, code: 'not_found', message: `nothing called "${q}" here`, query: q };
    return { ok: true, ...r };
  }
  return { ok: false, code: 'invalid', message: `unknown op ${req.op}` };
}

async function remote(path, body) {
  const base = (process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/$/, '');
  const res = await fetch(`${base}/api/plugins/${FOLDER}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.AXF_TOKEN ? { authorization: `Bearer ${process.env.AXF_TOKEN}` } : {}) }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  return { status: res.status, ...j };
}

async function main(argv) {
  const json = argv.includes('--json');
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && /^--(touches|how|to)$/.test(argv[i - 1])));
  const [cmd, ...rest] = pos;
  const say = (r, text) => { console.log(json ? JSON.stringify(r) : text); if (!r.ok) process.exitCode = r.code === 'not_found' ? 4 : 1; };
  if (cmd === 'run') { let s = ''; for await (const c of process.stdin) s += c; let req = {}; try { req = JSON.parse(s || '{}'); } catch { /* empty */ } console.log(JSON.stringify(run(req))); return; }
  if (cmd === 'targets') { const r = run({ op: 'targets' }); return say(r, r.targets.map((t) => `${t.id.padEnd(48)} ${t.label}`).join('\n')); }
  if (cmd === 'find') {
    const r = run({ op: 'find', text: rest.join(' '), touches: opt('touches') });
    return say(r, r.ok ? (r.spans.length ? r.spans.map((s) => `${JSON.stringify(s.text).padEnd(36)} → ${s.ref}${s.ambiguous ? ` (ambiguous: also ${s.candidates.join(', ')})` : ''}${s.missing ? ' (not live yet)' : ''}`).join('\n') : 'No references.') : r.message);
  }
  if (cmd === 'resolve') { const r = run({ op: 'resolve', query: rest.join(' ') }); return say(r, r.ok ? `${r.target.id} · ${r.target.label}${r.ambiguous ? `\n  also: ${r.candidates.map((c) => c.id).join(', ')}` : ''}` : r.message); }
  if (cmd === 'open') {
    const how = opt('how') || 'open';
    if (!rest.length || !HOWS.includes(how)) { console.error('usage: refs.mjs open <ref> [--how open|window|review|build] [--to recent|all|<client>]'); process.exitCode = 2; return; }
    const r = await remote('open', { ref: rest.join(' '), how, ...(opt('to') ? { to: opt('to') } : {}), by: process.env.AXF_SESSION || 'cli' });
    return say(r, r.ok ? `opened ${r.target?.label ?? rest.join(' ')}${(r.delivered ?? []).map((d) => `\n  ${d.client}: ${d.message}`).join('')}` : r.message);
  }
  console.error('usage: refs.mjs find "<text>" [--touches a,b] | resolve <ref> | targets | open <ref> [--how …] [--to …] | run   (--json)');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
