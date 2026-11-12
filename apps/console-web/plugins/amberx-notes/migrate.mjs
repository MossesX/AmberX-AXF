#!/usr/bin/env node
/**
 * Moves a todo-store@1 file (the retired console Todo manager's store.json) into AmberX's notes: one AmberX list per
 * Todo-manager list (same nesting, under the list named by --into, default "Console todos"), every entry an amberx.items
 * row (kind, title, body, status, priority, due, tags, checklist kept; subtasks become tasks of their own with the parent
 * linked). Everything goes through control@1 (`axf control add amberx.lists | amberx.items`), so the AmberX notes rules
 * apply and the change is audited like any other.
 *
 *   node migrate.mjs [store.json] [--into "Console todos"] [--dry-run] [--json]
 * Default file: $AXF_TODO_DIR/store.json, else <repo>/.axf-console/plugins/todo-manager/store.json. A file with no
 * entries moves nothing (empty lists are not copied). Exit 0 done · 1 failed · 2 no such file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const AXF = join(ROOT, 'framework/cli/axf.mjs');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--into')
  ?? join(process.env.AXF_TODO_DIR || join(ROOT, '.axf-console/plugins/todo-manager'), 'store.json');
const dry = flag('--dry-run');

/** todo-store@1 → the plan: lists to make (parents first) and items, pure. */
export function plan(store, into = 'Console todos') {
  const lists = Array.isArray(store?.lists) ? store.lists : [];
  const entries = Array.isArray(store?.entries) ? store.entries : [];
  const used = new Set(entries.map((e) => e.listId));
  // keep a list when it, or a list under it, holds an entry
  const keep = new Set();
  for (const l of lists) if (used.has(l.id)) for (let x = l; x; x = lists.find((p) => p.id === x.parentId)) keep.add(x.id);
  const outLists = lists.filter((l) => keep.has(l.id)).sort((a, b) => depth(lists, a) - depth(lists, b) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((l) => ({ key: l.id, name: String(l.title || 'Untitled list').slice(0, 80), parentKey: l.parentId ?? null }));
  const status = (s) => (s === 'done' ? 'done' : s === 'in_progress' ? 'doing' : 'open');
  const priority = (p) => ({ low: 1, normal: 0, high: 2, urgent: 3 })[p] ?? 0;
  const due = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '');
  const items = entries.slice().sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0)).map((e) => ({
    key: e.id, listKey: e.listId, parentKey: e.parentId ?? null,
    value: {
      kind: ['note', 'todo', 'task'].includes(e.kind) ? e.kind : 'note',
      title: String(e.title || '').slice(0, 200), text: String(e.body || ''), status: status(e.status), priority: priority(e.priority),
      due: due(e.dueAt), tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
      checklist: (Array.isArray(e.checklist) ? e.checklist : []).map((c) => ({ text: String(c?.text ?? ''), done: !!c?.done })).filter((c) => c.text),
    },
  }));
  return { into, lists: items.length ? outLists : [], items };
}
function depth(lists, l) { let d = 0; for (let x = l; x?.parentId; x = lists.find((p) => p.id === x.parentId)) d++; return d; }

function control(target, value) {
  const r = spawnSync(process.execPath, [AXF, 'control', 'add', target, JSON.stringify(value), '--by', 'amberx-notes:migrate', '--json'], { encoding: 'utf8', cwd: ROOT });
  let out = null; try { out = JSON.parse(r.stdout); } catch { /* not JSON */ }
  if (r.status !== 0 || !out?.ok) throw new Error(`${target} add failed: ${(out?.message ?? (r.stderr || r.stdout)).trim()}`);
  return out.item;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(file)) { console.error(`no todo store at ${file}`); process.exit(2); }
  const p = plan(JSON.parse(readFileSync(file, 'utf8')), opt('--into', 'Console todos'));
  const report = { file, into: p.into, lists: p.lists.length, items: p.items.length, dryRun: dry, moved: 0 };
  if (!dry && p.items.length) {
    try {
      const root = control('amberx.lists', { name: p.into });
      const listIds = new Map();
      for (const l of p.lists) listIds.set(l.key, control('amberx.lists', { name: l.name, parent: l.parentKey ? listIds.get(l.parentKey) : root.id }).id);
      const itemIds = new Map();
      for (const it of p.items) {
        const made = control('amberx.items', { ...it.value, list: listIds.get(it.listKey) ?? root.id, ...(it.parentKey && itemIds.get(it.parentKey) ? { parent: itemIds.get(it.parentKey) } : {}) });
        itemIds.set(it.key, made.id); report.moved++;
      }
    } catch (e) { report.error = e.message; }
  }
  if (flag('--json')) console.log(JSON.stringify(report));
  else console.log(`${report.error ? 'stopped' : dry ? 'would move' : 'moved'} ${dry ? report.items : report.moved} of ${report.items} entries (${report.lists} lists) from ${file} into AmberX "${report.into}"${report.error ? `: ${report.error}` : ''}`);
  process.exit(report.error ? 1 : 0);
}
