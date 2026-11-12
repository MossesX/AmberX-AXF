/**
 * Parity and coverage of the control registry (control-registry@1; build full-api-cli-control-of-everything-plus-an-
 * offli, s16). Brett, Nov 10 2026: control "over every single page, app, plugin, tool, behavior, display, and setting
 * with every single option or possibility for a parameter".
 *
 * Findings (each has a stable key, so a baseline can hold the ones known today and anything new fails):
 *   missing-entry      a UI page (view / dialog / settings tab of a console or Molly plugin), a console action or a
 *                      settings-registry key with no registry entry
 *   surface            an entry that is not reached on REST, MCP, CLI or voice and gives no reason (only an
 *                      automatic gap, or none): a declared gap with a reason is a decision, not a finding
 *   params             a string / number parameter with no allowed values (enum, range, pattern, length, `of`)
 *   console-sync       an entry whose console target and deep link disagree
 *   stale              the committed index differs from the sources (run index.mjs build --write)
 *
 * `report(findings, index)` writes the gap report: every gap of every entry by owner (declared and automatic).
 * No AI anywhere here.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gapsOf } from '../../../../framework/core/engines/control-registry.mjs';
import { ROOT } from './collect.mjs';
import { registry as pluginRegistry } from '../../../../framework/cli/plugin-commands.mjs';
import { consoleSyncProblems } from './execute.mjs';

export const BASELINE_FILE = join(ROOT, '_claude', 'builds', 'registry', 'coverage-baseline.json');
export const REPORT_FILE = join(ROOT, '_claude', 'builds', 'registry', 'gaps.md');
const AUTO = [/^no phrase declared for it yet/, /^nothing to open: it has no view/, /declares no allowed values/, /^declared unreachable on /];
const SURFACES = ['rest', 'mcp', 'cli', 'voice'];
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const isAuto = (g) => AUTO.some((re) => re.test(g.why ?? ''));
const needsAllowed = (p) => ['string', 'number', 'integer'].includes(p.type) && p.enum === undefined && p.min === undefined && p.max === undefined && !p.pattern && !p.of && p.maxLength === undefined;

/** What the UI has, from the files that define it: plugin views, dialogs, settings tabs, actions; settings-registry keys. */
export function uiInventory(root = ROOT) {
  const out = [];
  for (const [app, dir] of [['console-web', 'apps/console-web/plugins'], ['molly', 'apps/molly/plugins']]) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const folder of readdirSync(base).sort()) {
      if (folder.startsWith('_') || folder.startsWith('.')) continue;
      const m = readJson(join(base, folder, 'plugin.json'));
      if (!m) continue;
      for (const pr of (m.provides ?? []).map(String)) {
        const [kind, ...rest] = pr.split(':'); const name = rest.join(':');
        if (!name || !['view', 'dialog', 'settings-tab', 'action'].includes(kind)) continue;
        if (kind === 'action' && app !== 'console-web') continue;
        out.push({ app, folder, kind, name, key: `${app}:${pr}` });
      }
      const reg = app === 'console-web' ? readJson(join(base, folder, 'registry.json')) : null;
      if (reg && Array.isArray(reg.settings) && /-registry@1$/.test(String(reg.$axf ?? ''))) for (const s of reg.settings) if (s?.key) out.push({ app, folder, kind: 'setting', name: s.key, key: `${app}:setting:${folder}/${s.key}` });
    }
  }
  return out;
}

/** Does the index have an entry for this UI thing? (by the ids, aliases and where-fields the collectors give them) */
function covered(index, item) {
  const { app, folder, kind, name } = item;
  const ids = new Set(index.entries.map((e) => e.id));
  if (kind === 'setting') return ids.has(`${app}/setting/${folder}/${name.replace(/[^A-Za-z0-9._:@-]+/g, '-')}`);
  const want = kind === 'view' ? [`${app}/page/${name}`] : kind === 'dialog' ? [`${app}/page/dialog/${name}`] : kind === 'settings-tab' ? [`${app}/page/settings/${name}`] : [];
  if (want.some((w) => ids.has(w))) return true;
  if (kind === 'action') { const t = actionToolOf(folder, name); if (t && ids.has(t)) return true; if (index.entries.some((e) => e.where?.plugin === folder && (e.description ?? '').includes(`Runs the ${name} action`))) return true; }
  const alias = `${kind}:${name}`;
  return index.entries.some((e) => e.owner === app && (e.aliases ?? []).some((a) => a === alias || a === `${app}:${alias}`) || (kind === 'action' && e.owner === app && e.actions.some((a) => a.run === `action:${name}` || a.run.startsWith(`action:${name}:`))) || (kind === 'action' && e.owner === app && e.where?.plugin === folder && e.actions.some((a) => a.run === `${folder}/${name}` || a.run.endsWith(`/${name.replace(/\./g, '-')}`))));
}

/** Console actions that plugin-commands@1 turned into commands: action id → the tool entry id that runs it. */
let actionTools = null;
function actionToolOf(folder, name) {
  if (!actionTools) {
    actionTools = new Map();
    try { for (const p of pluginRegistry({ apps: ['console-web'] }).plugins) for (const c of p.commands ?? []) if (c.run?.action) actionTools.set(`${p.folder}|${c.run.action}`, `console-web/tool/${p.folder}/${c.id}`); } catch { /* no registry: fall back to the index */ }
  }
  return actionTools.get(`${folder}|${name}`) ?? '';
}

/** Every finding for an index (and, with `changes`, whether it is stale). → [{ key, kind, entry?, what, why }]. */
export function findings(index, { root = ROOT, stale = null } = {}) {
  const out = [];
  for (const item of uiInventory(root)) if (!covered(index, item)) out.push({ key: `missing-entry:${item.key}`, kind: 'missing-entry', what: item.kind, why: `${item.app} ${item.kind} "${item.name}" (plugin ${item.folder}) has no registry entry` });
  const byId = new Map(index.entries.map((e) => [e.id, e]));
  for (const e of index.entries) {
    const gaps = e.gaps ?? [];
    for (const s of SURFACES) {
      const reached = Array.isArray(e.surfaces?.[s]) ? e.surfaces[s].length > 0 : e.surfaces?.[s] !== false && e.surfaces?.[s] !== undefined;
      if (reached) continue;
      if (s === 'voice' && e.type === 'tool' && e.actions.every((a) => a.effect === 'read')) continue; // nobody says a plain read
      if (!e.actions.length && gaps.some((g) => g.what === 'actions' && !isAuto(g))) continue; // nothing to reach, reason given
      if (s === 'voice' && e.type === 'plugin') { const page = byId.get(`${e.owner}/page/settings/${e.where?.plugin}`); if (page && Array.isArray(page.surfaces?.voice) && page.surfaces.voice.length) continue; } // its settings page is what you say
      const reason = gaps.find((g) => g.what === s && !isAuto(g));
      if (!reason) out.push({ key: `surface:${e.id}:${s}`, kind: 'surface', entry: e.id, what: s, why: `${e.id} is not reached on ${s} and gives no reason` });
    }
    for (const a of e.actions) for (const p of a.params ?? []) {
      if (!needsAllowed(p)) continue;
      if (gaps.some((g) => g.what === 'params' && !isAuto(g) && g.why.includes(`${a.id}.${p.name}`))) continue;
      out.push({ key: `params:${e.id}:${a.id}.${p.name}`, kind: 'params', entry: e.id, what: `${a.id}.${p.name}`, why: `${e.id} · ${a.id} --${p.name} (${p.type}) has no allowed values` });
    }
  }
  for (const p of consoleSyncProblems(index)) out.push({ key: `console-sync:${p.entry}`, kind: 'console-sync', entry: p.entry, what: 'deepLink', why: `${p.entry}: console target ${p.open} but deep link ${p.deepLink ?? 'none'} (want ${p.want})` });
  if (stale) out.push({ key: 'stale:index', kind: 'stale', what: 'index', why: `the committed index is stale (+${stale.added.length} -${stale.removed.length} ~${stale.changed.length}): node apps/console-web/lib/registry/index.mjs build --write` });
  return out;
}

/** The baseline: finding keys accepted when it was written (shrink it; never grow it by hand). */
export const readBaseline = (file = BASELINE_FILE) => new Set(readJson(file)?.keys ?? []);

/** Compare findings with the baseline. → { fresh: findings not in it (fail), fixed: keys in it no longer found, held }. */
export function compare(all, baseline) {
  const keys = new Set(all.map((f) => f.key));
  return { fresh: all.filter((f) => !baseline.has(f.key) || f.kind === 'stale'), fixed: [...baseline].filter((k) => !keys.has(k)), held: all.filter((f) => baseline.has(f.key) && f.kind !== 'stale') };
}

/** The gap report (markdown): totals, then every gap by owner, then the open findings. */
export function report(index, all) {
  const gaps = gapsOf(index);
  const byOwner = new Map();
  for (const g of gaps) { const owner = g.entry.split('/')[0]; if (!byOwner.has(owner)) byOwner.set(owner, []); byOwner.get(owner).push(g); }
  const counts = (list) => Object.entries(list.reduce((m, g) => { m[g.what] = (m[g.what] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k} ${v}`).join(', ');
  const lines = ['# Control registry: gap report', '', `Generated by \`node scripts/check-registry-coverage.mjs --report\` from index ${index.hash} (${index.entries.length} entries, ${index.counts?.actions ?? '?'} actions). Do not edit: fix the declaration and rebuild.`, '',
    '| Owner | Entries | Gaps | By kind |', '|---|---|---|---|'];
  for (const o of index.owners) { const g = byOwner.get(o.id) ?? []; lines.push(`| ${o.label} (\`${o.id}\`) | ${index.counts?.byOwner?.[o.id] ?? 0} | ${g.length} | ${counts(g) || 'none'} |`); }
  lines.push('', `Coverage findings: ${all.length} (${Object.entries(all.reduce((m, f) => { m[f.kind] = (m[f.kind] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}). Declared gaps with a reason are decisions and are not findings.`, '');
  for (const o of index.owners) {
    const g = (byOwner.get(o.id) ?? []).filter((x) => !isAuto(x));
    if (!g.length) continue;
    lines.push(`## ${o.label}: declared gaps`, '');
    const seen = new Set();
    for (const x of g) { const k = `${x.what}|${x.why}`; const n = g.filter((y) => `${y.what}|${y.why}` === k).length; if (seen.has(k)) continue; seen.add(k); lines.push(`- **${x.what}** ${n > 1 ? `(${n} entries, e.g. \`${x.entry}\`)` : `\`${x.entry}\``}: ${x.why}${x.plan ? ` _Plan: ${x.plan}_` : ''}`); }
    lines.push('');
  }
  if (all.length) {
    lines.push('## Open findings (held by the baseline until fixed)', '');
    const byKind = all.reduce((m, f) => { (m[f.kind] ??= []).push(f); return m; }, {});
    for (const [k, list] of Object.entries(byKind)) { lines.push(`### ${k} (${list.length})`, ''); for (const f of list.slice(0, 400)) lines.push(`- ${f.why}`); if (list.length > 400) lines.push(`- … ${list.length - 400} more`); lines.push(''); }
  }
  return `${lines.join('\n')}\n`;
}
