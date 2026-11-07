#!/usr/bin/env node
/**
 * build-origin — what Brett said that started each build (build-origin@1, framework/core/build-origin.mjs), on the
 * build's record in the one builds store. Zero tokens: plain reads and writes, no model call.
 *
 *   node framework/cli/build-origin.mjs get <id>                          his words, addenda, brief (text; --json = the record)
 *   … set <id> --said "<verbatim>" [--source voice|chat|console|code] [--at iso] [--session id] [--link url] [--by who]
 *          [--brief-file f]                                               record his words (refused when the build already has
 *                                                                         verbatim words that differ: add an addendum instead)
 *   … addendum <id> --said "<verbatim>" [--source …] [--at iso] [--by who] a later change he asked for
 *   … capture --brief <file> [--build id] [--name n] [--by who]            the launcher's hook: parse the brief's
 *                                                                         "## Brett said (verbatim)" + "## Addendum N" blocks
 *                                                                         into the build it belongs to (no build = nothing)
 *   … backfill [--apply] [--builds-dir /root/axf-builds]                  fill origin for builds that have none, from their
 *                                                                         brief file, detail, notes (dry run unless --apply)
 *   … missing                                                             builds with no origin yet
 *   … block [--said "…"] [--source …]                                     the brief template's block, ready to paste
 *   --json on any command prints JSON.
 *
 * The server routes (build-orchestrator plugin: GET /origin/{id}, POST /origin/{id}, POST /origin/{id}/addendum) call
 * this CLI, so the same commands are on REST /api/control, MCP and `axf build-orchestrator …` (plugin-commands@1).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as og from '../core/build-origin.mjs';
import { findBuild as gateFind } from './model-gate.mjs';
import { loadStore, withStore } from './builds-store.mjs';
import { normStep } from '../plan/builds-store-core.mjs';

const by0 = () => process.env.AXF_AGENT || process.env.AXF_SESSION || process.env.AXF_ACTOR || 'build-origin';

function flags(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--apply' || a === '--replace') f[a.slice(2)] = true;
    else if (a.startsWith('--')) { f[a.slice(2)] = argv[i + 1] ?? ''; i += 1; }
    else f._.push(a);
  }
  return f;
}

const live = (s) => s.builds.filter((b) => !b.deleted);
const byId = (s, id) => (id ? live(s).find((b) => b.id === id) ?? live(s).find((b) => b.pendingId === id) ?? null : null);

/** The build a brief belongs to: --build, AXF_BUILD_ID, `# Build: <id>`, the launcher's --name, or the orchestrator's brief line. */
export function buildForBrief(store, { build = '', name = '', brief = '' } = {}) {
  const head = /^#\s*(?:Build|Job|Fix|Rebuild)\s*:\s*([a-z0-9][a-z0-9._-]*)/im.exec(brief)?.[1] ?? '';
  const reg = /\(id `([a-z0-9][a-z0-9._-]*)`/.exec(brief)?.[1] ?? '';
  return byId(store, build) ?? byId(store, process.env.AXF_BUILD_ID || '') ?? byId(store, String(name).replace(/^axf-/, '')) ?? byId(store, head) ?? byId(store, reg) ?? gateFind(store, { name, brief });
}

/** Record or merge an origin onto one build under the store lock. */
export function writeOrigin(id, next, { action = 'origin:set', by = by0(), replace = false } = {}) {
  let out = null;
  withStore((s) => {
    const b = byId(s, id); if (!b) throw new Error(`no build "${id}"`);
    const cur = og.normOrigin(b.origin);
    const inc = og.normOrigin(next);
    if (!inc) throw new Error('nothing to record: give what Brett said (--said)');
    if (!replace && cur?.said && cur.verbatim && inc.said && inc.verbatim && inc.said !== cur.said) {
      throw new Error(`${b.id} already has Brett's verbatim words; his words are never replaced. Add a later change as an addendum (build-origin.mjs addendum ${b.id} --said "…")`);
    }
    // backfilled words (may be paraphrased) give way to his real words
    const base = cur && inc.said && inc.verbatim && cur.said && !cur.verbatim ? { ...cur, said: '', at: '', source: '', from: '', verbatim: false } : cur;
    b.origin = og.mergeOrigin(inc, base);
    b.updatedAt = new Date().toISOString();
    out = b;
    return s;
  }, { by, action, note: id });
  return out;
}

/** Every addendum becomes a check-off item on the build: real steps, so the orchestrator ticks them. */
function checkoffs(b, plans, at) {
  const made = og.attachCheckoffs(b, plans, { norm: (s, i) => normStep(s, i, { now: at }), at });
  if (made && !b.rearranged) b.defaultSteps = b.steps.map((s) => ({ ...s }));
  return made;
}

export function addAddendumTo(id, ad, { by = by0() } = {}) {
  let out = null;
  withStore((s) => {
    const b = byId(s, id); if (!b) throw new Error(`no build "${id}"`);
    const at = new Date().toISOString();
    b.origin = og.addAddendum(b.origin, { by, ...ad });
    checkoffs(b, [ad], at);
    b.updatedAt = at;
    out = b;
    return s;
  }, { by, action: 'origin:addendum', note: id });
  return out;
}

/** The launcher's capture: brief → origin on its build. Returns { ok, build?, said?, warn? }. */
export function capture({ briefText, build = '', name = '', by = by0() }) {
  const store = loadStore();
  const b = buildForBrief(store, { build, name, brief: briefText });
  const p = og.parseBrief(briefText);
  const warn = p.hasBlock && p.said ? '' : `the brief has no "${og.SAID_HEADING}" block${p.said ? ` (took the first quote of Brett instead, marked from the brief)` : ''}`;
  if (!b) return { ok: true, build: null, said: p.said, warn: warn || '', note: 'not an orchestrator build: nothing recorded' };
  const next = { ...p, brief: briefText, by };
  const cur = og.normOrigin(b.origin);
  // a brief launched again with the same words: only new addenda / the brief come in
  writeOrigin(b.id, cur?.said && cur.verbatim && p.said !== cur.said ? { ...next, said: '', verbatim: false } : next, { action: 'origin:capture', by });
  let r = null;
  withStore((s) => { r = byId(s, b.id); if (checkoffs(r, p.addenda, new Date().toISOString())) r.updatedAt = new Date().toISOString(); return s; }, { by, action: 'origin:addendum', note: b.id });
  return { ok: true, build: b.id, said: og.subtitle(r.origin), addenda: r.origin?.addenda?.length ?? 0, warn };
}

// ------------------------------------------------------------------ backfill (s4)

/** Where each build's old words might be: its brief file, its detail, its notes. Pure apart from reading the briefs. */
export function backfillPlan(store, { buildsDir = process.env.AXF_BUILDS_DIR || '/root/axf-builds', readBrief = defaultReadBrief(buildsDir) } = {}) {
  const out = [];
  for (const b of live(store)) {
    if (og.normOrigin(b.origin)?.said) continue;
    const year = (b.createdAt || '').slice(0, 4);
    const briefText = readBrief(b.id) || (b.pendingId && b.pendingId !== b.id ? readBrief(b.pendingId) : '');
    let found = null;
    if (briefText) { const p = og.parseBrief(briefText, { year }); if (p.said) found = { ...p, from: p.hasBlock ? '' : 'brief', verbatim: p.hasBlock ? true : p.verbatim, brief: briefText }; }
    if (!found) { const q = og.fromText(b.detail, { year }); if (q) found = { ...q, from: 'detail' }; }
    if (!found) for (const n of b.notes ?? []) { const q = og.fromText(n.text, { year }); if (q) { found = { ...q, from: 'notes', at: q.at || n.at || '' }; break; } }
    if (!found && briefText) found = { said: '', brief: briefText, from: 'brief', verbatim: false };
    if (!found) continue;
    // Backfilled words are only called verbatim when the old text said so in as many words; otherwise "may be paraphrased"
    if (found.from) found.verbatim = found.verbatim === true && /verbatim/i.test((briefText || b.detail || '').slice(0, 4000));
    out.push({ id: b.id, origin: og.normOrigin({ ...found, by: found.by || 'backfill' }) });
  }
  return out.filter((x) => x.origin);
}
function defaultReadBrief(dir) {
  let names = null;
  return (id) => {
    if (!id || !existsSync(dir)) return '';
    names ??= new Set(readdirSync(dir));
    for (const n of [id, id.replace(/[^a-z0-9-]/gi, '-')]) {
      if (!names.has(n)) continue;
      for (const f of ['.brief.md', 'BRIEF.md', 'brief.md']) { const p = join(dir, n, f); if (existsSync(p)) { try { return readFileSync(p, 'utf8'); } catch { /* unreadable */ } } }
    }
    return '';
  };
}
export function applyBackfill(plan, { by = 'backfill' } = {}) {
  if (!plan.length) return { changed: 0 };
  let changed = 0;
  withStore((s) => {
    for (const x of plan) {
      const b = byId(s, x.id); if (!b || og.normOrigin(b.origin)?.said) continue;
      b.origin = og.mergeOrigin(b.origin, x.origin); changed += 1;
    }
    return s;
  }, { by, action: 'origin:backfill', note: `${plan.length} builds` });
  return { changed };
}

// ------------------------------------------------------------------ CLI

function show(b) {
  const o = og.normOrigin(b.origin);
  if (!o) return `${b.id}: no record of what Brett said yet (build-origin.mjs set ${b.id} --said "…")`;
  return [`${b.title} (${b.id})`, og.originText(o) || '(no words recorded, only the brief)',
    o.by ? `Launched by: ${o.by}` : '', o.session ? `Session: ${o.session}` : '', o.link ? `Link: ${o.link}` : '',
    o.brief ? `Brief: ${o.brief.length} characters (--json for the text)` : ''].filter(Boolean).join('\n');
}

async function main(argv) {
  const f = flags(argv);
  const [cmd = 'missing', id] = f._;
  const out = (o, text) => console.log(f.json ? JSON.stringify(o) : text);
  const ad = () => ({ said: f.said ?? '', source: f.source ?? '', at: f.at ?? '', by: f.by || by0() });
  if (cmd === 'block') return out({ ok: true, block: og.saidBlock({ said: f.said, source: f.source, at: f.at, session: f.session, link: f.link }) }, og.saidBlock({ said: f.said, source: f.source, at: f.at, session: f.session, link: f.link }));
  if (cmd === 'get') {
    const b = byId(loadStore(), id); if (!b) throw new Error(`no build "${id}"`);
    return out({ ok: true, id: b.id, title: b.title, origin: og.normOrigin(b.origin), subtitle: og.subtitle(b.origin) }, show(b));
  }
  if (cmd === 'set') {
    if (!id) throw new Error('set <id> --said "…"');
    const brief = f['brief-file'] ? readFileSync(f['brief-file'], 'utf8') : '';
    const b = writeOrigin(id, { ...ad(), session: f.session ?? '', link: f.link ?? '', brief, verbatim: true }, { replace: !!f.replace });
    return out({ ok: true, id: b.id, origin: b.origin }, `recorded what Brett said on ${b.id}: "${og.subtitle(b.origin)}"`);
  }
  if (cmd === 'addendum') {
    if (!id || !f.said) throw new Error('addendum <id> --said "…"');
    const b = addAddendumTo(id, ad());
    return out({ ok: true, id: b.id, origin: b.origin }, `addendum ${b.origin.addenda.length} on ${b.id}`);
  }
  if (cmd === 'capture') {
    if (!f.brief || !existsSync(f.brief)) throw new Error('capture --brief <file>');
    const r = capture({ briefText: readFileSync(f.brief, 'utf8'), build: f.build ?? '', name: f.name ?? '', by: f.by || by0() });
    return out(r, r.build ? `origin: ${r.build} ← "${r.said}"${r.addenda ? ` (+${r.addenda} addenda)` : ''}${r.warn ? `\nwarning: ${r.warn}` : ''}` : `origin: ${r.note}${r.warn ? ` (${r.warn})` : ''}`);
  }
  if (cmd === 'backfill') {
    const plan = backfillPlan(loadStore(), { buildsDir: f['builds-dir'] || undefined });
    const counts = plan.reduce((m, x) => { const k = x.origin.said ? `${x.origin.from || 'brief block'}${x.origin.verbatim ? ' (verbatim)' : ' (may be paraphrased)'}` : 'brief only, no words'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
    const r = f.apply ? applyBackfill(plan) : { changed: 0 };
    return out({ ok: true, apply: !!f.apply, found: plan.length, changed: r.changed, counts, builds: plan.map((x) => ({ id: x.id, from: x.origin.from, verbatim: x.origin.verbatim, said: og.subtitle(x.origin, 100) })) },
      [`${f.apply ? 'filled' : 'would fill'} ${f.apply ? r.changed : plan.length} builds:`, ...Object.entries(counts).map(([k, v]) => `  ${v} from ${k}`), f.apply ? '' : 'dry run: --apply writes them'].filter(Boolean).join('\n'));
  }
  if (cmd === 'missing') {
    const s = loadStore();
    const miss = live(s).filter((b) => !og.normOrigin(b.origin)?.said && b.status !== 'archived');
    return out({ ok: true, count: miss.length, ids: miss.map((b) => b.id) }, miss.length ? `${miss.length} builds without Brett's words:\n${miss.map((b) => `  ${b.id}`).join('\n')}` : 'every open build has what Brett said');
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
