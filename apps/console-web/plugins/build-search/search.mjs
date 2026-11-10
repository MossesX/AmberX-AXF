#!/usr/bin/env node
/**
 * Build search CLI (build-search@1). The server part runs it too, so a terminal, the REST API, MCP and the console view
 * share one set of rules. No model calls anywhere; the AI switch only records whether AI features may run.
 *
 *   node apps/console-web/plugins/build-search/search.mjs search "<query>" [--type log,note] [--build <id>] [--limit N] [--per-doc N]
 *   … open <hit id | doc id> [--line N] [--context N]     the document around that spot (the log viewer's data)
 *   … sources                                           built-in sources with counts + your own
 *   … source-add <name> <path|folder|glob> [--type T]    … source-remove <id>
 *   … actions                                           built-in + your own hit actions
 *   … action-add <label> <run> [--types a,b] [--icon I]  … action-remove <id>
 *   … settings                                          … set <key> <value>  (maxHits, maxPerDoc, context, snippet, types)
 *   … ai [on|off]                                       the AI switch (off by default)
 *   … run "<typed command>"                             the same commands as typing '>' in the search box
 *   --json prints one JSON object (the server reads the last line).
 */
import { actionsFor, applyCommand, around, BUILTIN_ACTIONS, parseCommand, parseHitId, search } from './engine.mjs';
import { loadDoc, loadDocs, loadSettings, saveSettings, sourceSummary } from './sources.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') continue;
  if (a.startsWith('--')) { flags[a.slice(2)] = argv[i + 1] ?? ''; i++; } else pos.push(a);
}
const list = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);

function out(obj, text) {
  if (json) process.stdout.write(`${JSON.stringify(obj)}\n`);
  else process.stdout.write(`${text ?? JSON.stringify(obj, null, 1)}\n`);
  if (obj && obj.ok === false) process.exitCode = 1;
}

function applyAndSave(cmd) {
  const r = applyCommand(loadSettings(), cmd);
  if (r.error) return { ok: false, error: r.error };
  const settings = r.changed ? saveSettings(r.settings) : r.settings;
  return { ok: true, changed: r.changed, message: r.message, settings };
}

const [cmd = 'help', ...rest] = pos;
switch (cmd) {
  case 'search': {
    const q = rest.join(' ');
    const settings = loadSettings();
    const types = list(flags.type);
    const t0 = Date.now();
    const docs = loadDocs({ types: types.length ? types : undefined, build: flags.build, settings });
    const r = search(docs, q, { settings, types, build: flags.build, limit: flags.limit, perDoc: flags['per-doc'] });
    const res = { ok: !r.error, ...r, ms: Date.now() - t0 };
    out(res, [`${r.total} hit(s) in ${r.docs} document(s)${r.truncated ? ' (more not shown)' : ''}${r.error ? ` · ${r.error}` : ''}`,
      ...r.groups.flatMap((g) => [`[${g.typeLabel}] ${g.title} · ${g.count}`, ...g.hits.map((h) => `   instance ${h.n} · line ${h.line} · ${h.text}   (${h.id})`)])].join('\n'));
    break;
  }
  case 'open': case 'doc': case 'hit': {
    const { doc: docId, line: hitLine } = parseHitId(rest[0]);
    const settings = loadSettings();
    const doc = loadDoc(docId, settings);
    if (!doc) { out({ ok: false, error: `no document ${docId}` }); break; }
    const line = Number(flags.line) || hitLine || 1;
    const a = around(doc, line, Number(flags.context) || 400);
    const group = { type: doc.type, build: doc.build };
    out({ ok: true, doc: { id: doc.id, type: doc.type, title: doc.title, build: doc.build ?? '', path: doc.path ?? '', at: doc.at ?? '' }, ...a, actions: actionsFor(group, settings) },
      a.lines.map((l, i) => `${a.start + i === a.line ? '>' : ' '} ${String(a.start + i).padStart(6)}  ${l}`).join('\n'));
    break;
  }
  case 'sources': { const s = sourceSummary(); out({ ok: true, ...s }, [...s.builtIn.map((x) => `${x.id}: ${x.label} (${x.count})`), ...s.user.map((x) => `${x.id}: ${x.path} as ${x.type} (${x.count} files)`)].join('\n')); break; }
  case 'source-add': { const r = applyAndSave({ op: 'add-source', source: { name: rest[0], path: rest.slice(1).join(' '), type: flags.type || 'file' } }); out(r, r.message ?? r.error); break; }
  case 'source-remove': { const r = applyAndSave({ op: 'remove-source', id: rest[0] }); out(r, r.message ?? r.error); break; }
  case 'actions': { const s = loadSettings(); out({ ok: true, builtIn: BUILTIN_ACTIONS, user: s.actions }, [...BUILTIN_ACTIONS.map((a) => `${a.id} (built in)`), ...s.actions.map((a) => `${a.id}: ${a.run}`)].join('\n')); break; }
  case 'action-add': { const r = applyAndSave({ op: 'add-action', action: { label: rest[0], run: rest.slice(1).join(' '), icon: flags.icon, types: list(flags.types) } }); out(r, r.message ?? r.error); break; }
  case 'action-remove': { const r = applyAndSave({ op: 'remove-action', id: rest[0] }); out(r, r.message ?? r.error); break; }
  case 'settings': { const s = loadSettings(); out({ ok: true, settings: s }); break; }
  case 'set': {
    const [key, ...v] = rest;
    const c = key === 'types' ? { op: 'types', types: list(v.join(',')) } : parseCommand(`set ${key} ${v.join(' ')}`);
    const r = applyAndSave(c); out(r, r.message ?? r.error); break;
  }
  case 'ai': {
    if (!rest[0]) { const s = loadSettings(); out({ ok: true, ai: s.ai }, `AI ${s.ai.enabled ? 'on' : 'off'}`); break; }
    const r = applyAndSave(parseCommand(`ai ${rest[0]}`)); out(r, r.message ?? r.error); break;
  }
  case 'run': { const r = applyAndSave(parseCommand(rest.join(' '))); out(r, r.message ?? r.error); break; }
  default:
    out({ ok: cmd === 'help', usage: 'search | open | sources | source-add | source-remove | actions | action-add | action-remove | settings | set | ai | run' },
      'usage: search.mjs search "<query>" | open <hit id> | sources | source-add | source-remove | actions | action-add | action-remove | settings | set | ai [on|off] | run "<typed command>"');
}
