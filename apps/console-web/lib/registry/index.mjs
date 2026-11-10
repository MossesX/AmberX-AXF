#!/usr/bin/env node
/**
 * The control registry in memory + its CLI (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli,
 * Nov 10 2026). Loads the offline index (_claude/builds/registry/index.json) or builds a fresh one from the collectors,
 * and answers list / get / search / by owner / by type / gaps / stats without the console and without a model.
 * The REST routes, MCP tools and `axf ctl` of the Opus steps (s4-s6) call these same functions.
 *
 *   node apps/console-web/lib/registry/index.mjs build [--write] [--json]      collect; --write stores the index file
 *   … check [--strict]                 the index file validates; --strict also fails when the sources changed since
 *   … diff                             what changed since the index file was written
 *   … list [--owner o] [--type t] [--tag t] [--surface s] [--plugin p] [--q words] [--limit n] [--json]
 *   … get <id | alias> [--json]        one entry, with its actions, parameters and allowed values
 *   … search <words> [--json]          ranked whole-word search
 *   … owners | types | gaps | stats    the index at a glance
 *   … export <file> | import <file>    the whole index out / in (import validates first)
 * Exit codes: 0 ok · 1 failed · 2 usage.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRY_TYPES, cliUsage, getEntry, listEntries, searchEntries, surfacesOf, allowedWords } from '../../../../framework/core/engines/control-registry.mjs';
import { INDEX_FILE, changes, checkIndex, exportTo, freshIndex, importFrom, readIndex, writeIndex } from './store.mjs';

export { INDEX_FILE, readIndex, writeIndex, freshIndex, changes, checkIndex, exportTo, importFrom };

/** The registry: an index plus the queries. `ControlRegistry.load()` prefers the file, builds when there is none. */
export class ControlRegistry {
  constructor(index) { this.index = index; }
  static fromFile(file) { const i = readIndex(file); return i ? new ControlRegistry(i) : null; }
  static build(opts) { const { index, errors } = freshIndex(opts); const r = new ControlRegistry(index); r.errors = errors; return r; }
  static load({ prefer = 'file', ...opts } = {}) { return (prefer === 'file' && ControlRegistry.fromFile()) || ControlRegistry.build(opts); }
  get entries() { return this.index.entries; }
  get hash() { return this.index.hash; }
  list(filter = {}) { return listEntries(this.index, filter); }
  get(id) { return getEntry(this.index, id); }
  search(q, opts = {}) { return searchEntries(this.index, q, opts); }
  byOwner(owner, filter = {}) { return listEntries(this.index, { ...filter, owner, limit: filter.limit ?? 2000 }); }
  byType(type, filter = {}) { return listEntries(this.index, { ...filter, type, limit: filter.limit ?? 2000 }); }
  owners() { return this.index.owners; }
  types() { return ENTRY_TYPES.map((t) => ({ type: t, count: this.index.counts?.byType?.[t] ?? 0 })); }
  gaps({ what = '', owner = '' } = {}) { return this.index.entries.flatMap((e) => (e.gaps ?? []).filter((g) => (!what || g.what === what) && (!owner || e.owner === owner)).map((g) => ({ entry: e.id, ...g }))); }
  stats() { return { ...this.index.counts, hash: this.index.hash, generatedAt: this.index.generatedAt, owners: this.index.owners.length }; }
  /** One entry as the CLI and the docs show it. */
  describe(id) {
    const e = this.get(id);
    if (!e) return null;
    const lines = [`${e.label}  (${e.id})  ${e.type} · ${e.owner}${e.needsAI ? ' · needs AI' : ''}`];
    if (e.description) lines.push(`  ${e.description.slice(0, 300)}`);
    const w = Object.entries(e.where).map(([k, v]) => `${k}=${v}`).join(' '); if (w) lines.push(`  where: ${w}`);
    const s = surfacesOf(e);
    if (s.open) lines.push(`  open:  ${s.open}${s.deepLink ? `  ·  ${s.deepLink}` : ''}`);
    if (e.state?.read) lines.push(`  state: ${e.state.read}${e.state.shape ? `  (${e.state.shape})` : ''}`);
    for (const f of e.state?.fields ?? []) lines.push(`         ${f.name}: ${allowedWords(f)}${f.default !== undefined ? ` (default ${JSON.stringify(f.default)})` : ''}`);
    lines.push(`  rest: ${s.rest ?? 'no'} · mcp: ${s.mcp ?? 'no'} · cli: ${s.cli ?? 'no'} · voice: ${s.voice ? s.voice.slice(0, 4).join(' / ') : 'no'}`);
    for (const a of e.actions) {
      lines.push(`  ${a.id.padEnd(12)} ${a.effect.padEnd(11)} → ${a.run}${a.confirm ? '  [confirm]' : ''}${a.needsAI ? '  [needs AI]' : ''}`);
      for (const p of a.params ?? []) lines.push(`      --${p.name}${p.required ? '' : '?'}  ${allowedWords(p)}${p.default !== undefined ? ` (default ${JSON.stringify(p.default)})` : ''}`);
      if (a.phrases?.length) lines.push(`      say: ${a.phrases.slice(0, 5).join(' / ')}`);
    }
    if (e.aliases?.length) lines.push(`  aliases: ${e.aliases.join(', ')}`);
    if (e.synonyms?.length) lines.push(`  synonyms: ${e.synonyms.join(', ')}`);
    for (const g of e.gaps ?? []) lines.push(`  gap ${g.what}: ${g.why}`);
    lines.push(...cliUsage(e).map((u) => `  ${u}`));
    return lines.join('\n');
  }
}

/* ================================================================== CLI */

function parseArgs(argv) {
  const flags = {}; const words = [];
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true; } else words.push(a); }
  return { flags, words };
}

export async function main(argv) {
  const { flags, words } = parseArgs(argv);
  const json = flags.json === true;
  const [cmd = 'stats', ...rest] = words;
  const out = (o, text) => { process.stdout.write(json ? `${JSON.stringify(o)}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`); };
  if (cmd === 'build') {
    const { index, errors } = freshIndex();
    if (flags.write) writeIndex(index);
    out({ ok: true, hash: index.hash, counts: index.counts, errors, written: flags.write ? INDEX_FILE : '' }, `${index.entries.length} entries · ${index.counts.actions} actions · hash ${index.hash}${flags.write ? `\nwritten: ${INDEX_FILE}` : ' (not written: add --write)'}${errors.length ? `\n${errors.map((e) => `  ✗ ${e}`).join('\n')}` : ''}`);
    return 0;
  }
  if (cmd === 'check') {
    const c = checkIndex();
    let stale = false; let diff = null;
    if (c.ok && flags.strict) { const ch = changes(); stale = ch.stale; diff = ch.diff; }
    out({ ok: c.ok && !stale, errors: c.errors, stale, diff }, c.ok ? (stale ? `✗ index is stale: +${diff.added.length} -${diff.removed.length} ~${diff.changed.length} (run build --write)` : `✓ ${INDEX_FILE} validates (control-registry@1)`) : `✗ ${c.errors.join('\n✗ ')}`);
    return c.ok && !stale ? 0 : 1;
  }
  if (cmd === 'diff') {
    const ch = changes();
    out({ stale: ch.stale, ...ch.diff, errors: ch.errors }, ch.stale ? `stale: +${ch.diff.added.length} -${ch.diff.removed.length} ~${ch.diff.changed.length}\n${[...ch.diff.added.map((x) => `  + ${x}`), ...ch.diff.removed.map((x) => `  - ${x}`), ...ch.diff.changed.map((x) => `  ~ ${x.id} (${x.fields.join(', ')})`)].join('\n')}` : 'up to date');
    return 0;
  }
  if (cmd === 'export') { if (!rest[0]) { console.error('usage: export <file>'); return 2; } const r = exportTo(rest[0], ControlRegistry.load().index); out(r, `exported ${r.entries} entries (hash ${r.hash}) to ${r.file}`); return 0; }
  if (cmd === 'import') { if (!rest[0]) { console.error('usage: import <file>'); return 2; } const r = importFrom(rest[0]); out(r, r.ok ? `imported ${r.entries} entries (hash ${r.hash}) → ${r.written}` : `✗ ${r.errors.join('\n✗ ')}`); return r.ok ? 0 : 1; }
  const reg = ControlRegistry.load({ prefer: flags.fresh ? 'build' : 'file' });
  if (cmd === 'list') {
    const r = reg.list({ owner: flags.owner ?? '', type: flags.type ?? '', tag: flags.tag ?? '', surface: flags.surface ?? '', plugin: flags.plugin ?? '', q: flags.q ?? rest.join(' '), limit: Number(flags.limit) || 50, ...(flags['needs-ai'] !== undefined ? { needsAI: flags['needs-ai'] !== 'false' } : {}) });
    out(r, `${r.items.map((e) => `${e.type.padEnd(9)} ${e.id.padEnd(60)} ${e.label}`).join('\n')}\n${r.items.length} of ${r.total}`);
    return 0;
  }
  if (cmd === 'get') { if (!rest[0]) { console.error('usage: get <id | alias>'); return 2; } const e = reg.get(rest[0]); if (!e) { out({ ok: false, code: 'not_found', candidates: reg.search(rest.join(' ').replace(/[/._:-]/g, ' '), { limit: 6 }).map((x) => x.entry.id) }, `no entry "${rest[0]}"`); return 1; } out(e, reg.describe(rest[0])); return 0; }
  if (cmd === 'search') { const hits = reg.search(rest.join(' '), { limit: Number(flags.limit) || 20, type: flags.type ?? '', owner: flags.owner ?? '' }); out(hits.map((h) => ({ id: h.entry.id, label: h.entry.label, type: h.entry.type, score: h.score })), hits.map((h) => `${String(h.score.toFixed(1)).padStart(6)}  ${h.entry.type.padEnd(9)} ${h.entry.id.padEnd(60)} ${h.entry.label}`).join('\n') || 'nothing matches'); return 0; }
  if (cmd === 'owners') { out(reg.owners(), reg.owners().map((o) => `${o.id.padEnd(20)} ${o.kind.padEnd(9)} ${o.label}${o.via ? `  via ${o.via}` : ''}  ${reg.index.counts.byOwner?.[o.id] ?? 0} entries`).join('\n')); return 0; }
  if (cmd === 'types') { out(reg.types(), reg.types().map((t) => `${t.type.padEnd(10)} ${t.count}`).join('\n')); return 0; }
  if (cmd === 'gaps') { const g = reg.gaps({ what: flags.what ?? '', owner: flags.owner ?? '' }); out(g, `${g.slice(0, Number(flags.limit) || 200).map((x) => `${x.what.padEnd(10)} ${x.entry.padEnd(60)} ${x.why}`).join('\n')}\n${g.length} gaps`); return 0; }
  if (cmd === 'stats') { const s = reg.stats(); out(s, `${s.entries} entries · ${s.actions} actions · ${s.owners} owners · needs AI ${s.needsAI} · gaps ${s.gaps}\nby type: ${Object.entries(s.byType).map(([k, v]) => `${k} ${v}`).join(', ')}\nby source: ${Object.entries(s.bySource).map(([k, v]) => `${k} ${v}`).join(', ')}\nsurfaces: ${Object.entries(s.surfaces).map(([k, v]) => `${k} ${v}`).join(', ')}\nhash ${s.hash} · ${s.generatedAt}`); return 0; }
  console.error('usage: index.mjs build [--write] | check [--strict] | diff | list [--owner --type --tag --surface --plugin --q --limit] | get <id> | search <words> | owners | types | gaps | stats | export <file> | import <file>  [--json] [--fresh]');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
