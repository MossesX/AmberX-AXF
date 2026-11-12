#!/usr/bin/env node
/**
 * Section owners (crew-sections@1): who owns each section that acts on its own, and its key events in the group chat as
 * that employee. Rules in web/sections-core.mjs; the catalogue is agents/sections.json; Brett's reassignments and the
 * dedupe log live in the data folder (sections.json, sections-said.json). Other code posts through
 * framework/cli/crew-say.mjs (found by capability service:crew-sections@1), never by naming this folder.
 *
 *   node apps/console-web/plugins/agent-swarm/sections.mjs list                       every section and its owner
 *   … assign <section> <agent> [note]           Brett's reassignment (posted in the chat)
 *   … post <section> <event> <text…> [--ref r] [--key k] [--dedupe-min n]   one event, as the owner (dropped while the chat is off)
 *   … check --usages '<json>'                    the CI check (framework/cli/crew-say.mjs check feeds it the call sites)
 *   --json on any command prints JSON.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sc from './web/sections-core.mjs';
import * as core from './web/swarm-core.mjs';
import { dataDir, loadRoster, readJson, withState, writeJson } from './swarm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const catalogFile = () => join(HERE, 'agents/sections.json');
export const overridesFile = () => join(dataDir(), 'sections.json');
export const saidFile = () => join(dataDir(), 'sections-said.json');

export const loadCatalog = () => sc.normSections(JSON.parse(readFileSync(catalogFile(), 'utf8')));
export const loadOverrides = () => sc.normOverrides(readJson(overridesFile(), {}));

export function board() { return sc.board(loadCatalog(), loadOverrides(), loadRoster()); }

/** Brett's reassignment: saved in the data folder and announced in the chat by Boss. */
export function assign(sectionId, agentRef, { by = process.env.AXF_ACTOR || 'Brett', note = '' } = {}) {
  const cat = loadCatalog(); const roster = loadRoster(); const at = new Date().toISOString();
  const r = sc.assign(cat, loadOverrides(), roster, sectionId, agentRef, at, by, note);
  writeJson(overridesFile(), { $axf: sc.TAG, ...r.overrides });
  if (r.changed) {
    const from = roster.agents.find((a) => a.id === r.from)?.name ?? r.from;
    withState((st) => core.post(st, [{ from: 'boss', kind: 'status', text: `${r.agent.name} now owns ${r.section.label}${from ? ` (was ${from})` : ''}.` }], at));
  }
  return { changed: r.changed, section: r.section.id, owner: r.agent.id, from: r.from };
}

/**
 * One section event in the chat, as the section's owner. Never posts while the chat (or that agent's voice) is off, and
 * the same line is posted once per dedupe window. Returns { posted, why?, owner }.
 */
export function post(sectionId, event, text, { ref = '', key = '', dedupeMin = sc.DEDUPE_MIN } = {}) {
  const cat = loadCatalog(); const roster = loadRoster(); const ov = loadOverrides();
  const errs = sc.postErrors(cat, roster, ov, sectionId, event, text);
  if (errs.length) throw new Error(errs.join('; '));
  const owner = sc.owners(cat, ov, roster)[sectionId];
  const at = new Date().toISOString();
  const k = sc.sayKey(sectionId, event, text, ref, key);
  const said = readJson(saidFile(), {});
  if (dedupeMin > 0 && sc.recentlySaid(said?.said, k, at, dedupeMin)) return { posted: false, why: 'said already', owner };
  const n = withState((st) => core.post(st, [sc.sectionLine(sectionId, owner, event, text, ref)], at));
  if (!n) return { posted: false, why: 'the group chat is off', owner };
  writeJson(saidFile(), { $axf: 'crew-sections-said@1', said: sc.remember(said?.said, k, at) });
  return { posted: true, owner };
}

/** The CI check over the call sites framework/cli/crew-say.mjs found. */
export function check({ usages = [], dynamic = [] } = {}) { return sc.checkUsages(loadCatalog(), loadRoster(), loadOverrides(), usages, dynamic); }

export async function main(argv) {
  const json = argv.includes('--json');
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? '' : ''; };
  const optNames = new Set(['--ref', '--key', '--dedupe-min', '--usages', '--note']);
  const args = argv.filter((a, i) => a !== '--json' && !optNames.has(a) && !optNames.has(argv[i - 1]));
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'list', ...rest] = args;
  if (cmd === 'list') {
    const b = board();
    return out({ ok: true, board: b }, b.sections.map((s) => `${s.id.padEnd(16)} ${s.name.padEnd(16)} ${s.reassigned ? '(reassigned) ' : ''}${s.events.join('/')}`).join('\n'));
  }
  if (cmd === 'assign') {
    const [section, agent, ...note] = rest; if (!section || !agent) throw new Error('assign <section> <agent> [note]');
    const r = assign(section, agent, { note: opt('note') || note.join(' ') });
    return out({ ok: true, ...r, board: board() }, r.changed ? `${section}: ${r.from} → ${r.owner}` : `${section}: already ${r.owner}`);
  }
  if (cmd === 'post') {
    const [section, event, ...words] = rest;
    const dm = opt('dedupe-min');
    const r = post(section, event, words.join(' '), { ref: opt('ref'), key: opt('key'), dedupeMin: dm === '' ? sc.DEDUPE_MIN : Number(dm) });
    return out({ ok: true, ...r }, r.posted ? `posted as ${r.owner}` : `not posted: ${r.why}`);
  }
  if (cmd === 'check') {
    const u = opt('usages'); const p = check(u ? JSON.parse(u) : {});
    if (p.length) process.exitCode = 1;
    return out({ ok: !p.length, problems: p }, p.length ? p.map((x) => `✗ ${x}`).join('\n') : 'every section that posts has an owner');
  }
  throw new Error(`unknown command ${cmd} (list | assign | post | check)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
