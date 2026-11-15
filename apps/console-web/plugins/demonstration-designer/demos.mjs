#!/usr/bin/env node
/**
 * Demonstration Designer store + CLI. Every pitch demo is a demonstration@1 asset (asset@1 envelope, the shape the
 * framework's player, Molly's guide and the recorder already play) in this plugin's data folder,
 * <dataDir>/demonstration/<id>.json, with its production facts (length, narrator, music, logo, topic) beside it in
 * <dataDir>/pitch/<id>.json, recordings in <dataDir>/media/ as clip@1 assets in <dataDir>/clip/, and the plugin's
 * settings (pitch-settings@1) in <dataDir>/settings.json. The glossary catalog indexes the demonstration folder of
 * every plugin that provides service:demonstrations@1, so each demo is a registry asset too.
 *
 *   node apps/console-web/plugins/demonstration-designer/demos.mjs topics [--kind k] [--q words]       what can be pitched
 *   node …/demos.mjs generate <topic id> [--minutes N] [--voice name] [--speed 1] [--save] [--build id]  the pitch script (zero tokens)
 *   node …/demos.mjs list | get <id> | delete <id>
 *   node …/demos.mjs save <file.json>                       an asset ({ ...asset@1, pitch? }) validated and stored
 *   node …/demos.mjs script <id> [--text <file>]            the script as text; with --text, the new words are applied
 *   node …/demos.mjs chain <id> <id2>[,<id3>…]              demos played after this one (a tour); "" clears
 *   node …/demos.mjs walkthrough <id>                       walkthrough@1 of the demo and its chain
 *   node …/demos.mjs media add <id> <file> [--seconds N] [--mime video/webm]   register a recording as a clip (copied in)
 *   node …/demos.mjs media list | export <clip id>          recordings; export transcodes to MP4 when ffmpeg is here
 *   node …/demos.mjs share <id>                              the deep link that opens / plays it
 *   node …/demos.mjs settings [get] | settings set <section.key> <value>
 *
 * Env: AXF_DEMO_DESIGNER_DIR (the data folder), AXF_REPO_ROOT, AXF_FFMPEG (an ffmpeg binary). No model, no network.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../../../framework/core/engines/demo-rules.mjs';
import * as E from './engine.mjs';
import { allTopics, getTopic } from './registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.AXF_REPO_ROOT || join(HERE, '../../../..');
export const DATA_DIR = process.env.AXF_DEMO_DESIGNER_DIR || join(ROOT, '.axf-console/plugins/demonstration-designer');
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(v, null, 1)}\n`); };
const dirOf = (kind) => join(DATA_DIR, kind);
const fileOf = (kind, id) => join(dirOf(kind), `${id}.json`);
const assertId = (id) => { if (!ID.test(id ?? '')) throw new Error(`"${id}" is not a demo id (lowercase letters, digits and dashes, 2 to 48)`); };

/* ---------------- settings ---------------- */

export function settings() {
  const f = join(DATA_DIR, 'settings.json');
  try { return E.normalizeSettings(existsSync(f) ? readJson(f) : {}); } catch { return E.normalizeSettings({}); }
}
export function saveSettings(patch) {
  const next = E.mergeSettings(settings(), patch);
  writeJson(join(DATA_DIR, 'settings.json'), { $axf: 'pitch-settings@1', ...next });
  return next;
}

/* ---------------- store ---------------- */

function listKind(kind) {
  const out = [];
  if (!existsSync(dirOf(kind))) return out;
  for (const f of readdirSync(dirOf(kind)).filter((n) => n.endsWith('.json')).sort()) {
    try { const a = readJson(join(dirOf(kind), f)); if (a?.$axf === 'asset@1' && a.id) out.push(a); } catch { /* a half-written file is skipped */ }
  }
  return out;
}
const pitchOf = (id) => { const f = fileOf('pitch', id); try { return existsSync(f) ? readJson(f) : null; } catch { return null; } };

/** One row per demo (what the list shows). */
export function summarize(a) {
  const d = a.data ?? {};
  const p = pitchOf(a.id) ?? {};
  const clips = listKind('clip').filter((c) => c.data?.source?.id === a.id).length;
  return { id: a.id, name: a.name, description: a.description ?? '', steps: (d.steps ?? []).length, seconds: E.pitchSeconds(d.steps ?? [], { ...p, speed: d.voice?.speed }), minutes: p.minutes ?? 0, topic: p.topic ?? d.about ?? '', topicLabel: p.topicLabel ?? '', narrator: d.voice?.narrator ?? '', chain: d.chain ?? [], clips, updatedAt: a.updatedAt ?? '' };
}

export const list = () => listKind('demonstration').map(summarize).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.name.localeCompare(b.name));

export function get(id) {
  assertId(id);
  const f = fileOf('demonstration', id);
  if (!existsSync(f)) return null;
  const a = readJson(f);
  return { ...a, pitch: pitchOf(id) ?? undefined };
}

/** Validate against demonstration@1, normalise, store (with the pitch facts beside it). Returns the stored record. */
export function save(raw, { reason = 'saved' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('a demo must be a JSON object');
  const id = E.slugify(raw.id ?? raw.name, '');
  assertId(id);
  const errors = R.demoAssetErrors('demonstration', raw.data);
  if (errors.length) throw new Error(`demonstration ${id}: ${errors.join('; ')}`);
  const data = R.normalizeDemonstration(raw.data);
  const a = { $axf: 'asset@1', type: 'demonstration', id, name: String(raw.name ?? id).trim().slice(0, 120) || id, version: String(raw.version ?? '1.0.0'), description: String(raw.description ?? '').slice(0, 600), author: String(raw.author ?? 'Demonstration Designer').slice(0, 80), tags: [...new Set(['demonstration', 'pitch', ...(Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [])])].slice(0, 20), data, updatedAt: new Date().toISOString() };
  writeJson(fileOf('demonstration', id), a);
  if (raw.pitch && typeof raw.pitch === 'object') writeJson(fileOf('pitch', id), { $axf: E.PITCH_FRAME, ...raw.pitch, reason });
  return { ...a, pitch: pitchOf(id) ?? undefined };
}

export function remove(id) {
  assertId(id);
  let removed = false;
  for (const kind of ['demonstration', 'pitch']) { const f = fileOf(kind, id); if (existsSync(f)) { rmSync(f); removed = true; } }
  return removed;
}

/* ---------------- generate ---------------- */

/** The pitch of a topic (a registry id or a topic object), with the settings' defaults filled in. `save` stores it. */
export function generate(topic, opts = {}) {
  const s = settings();
  const t = typeof topic === 'string' ? getTopic(topic) : topic;
  if (!t) throw new Error(`no topic ${topic} (demos.mjs topics lists them)`);
  const p = E.generatePitch(t, {
    minutes: opts.minutes ?? s.script.minutes, voice: { narrator: opts.narrator ?? opts.voice?.narrator ?? s.narration.voice, speed: opts.speed ?? opts.voice?.speed ?? s.narration.speed },
    cta: opts.cta ?? s.script.cta, product: opts.product ?? s.script.product, wpm: s.script.wpm, logoIntro: s.stage.logoIntro, logoOutro: s.stage.logoOutro, logoSeconds: s.stage.logoSeconds,
    at: new Date().toISOString(), build: opts.build ?? '',
  });
  const record = { $axf: 'asset@1', type: 'demonstration', id: p.id, name: p.name, description: p.description, tags: ['pitch', t.kind], data: p.data, pitch: { ...p.pitch, plan: p.plan } };
  return opts.save ? save(record, { reason: 'generated' }) : record;
}

/* ---------------- script, chain, walkthrough ---------------- */

export function script(id) { const a = get(id); if (!a) throw new Error(`no demo ${id}`); return E.scriptText(a.data.steps); }
export function applyScript(id, text) {
  const a = get(id); if (!a) throw new Error(`no demo ${id}`);
  const steps = E.parseScript(text, a.data.steps);
  if (!steps.length) throw new Error('the script needs at least one step');
  return save({ ...a, data: { ...a.data, steps } }, { reason: 'script' });
}
export function setChain(id, chain) {
  const a = get(id); if (!a) throw new Error(`no demo ${id}`);
  const ids = (Array.isArray(chain) ? chain : String(chain ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  for (const c of ids) { assertId(c); if (c === id) throw new Error('a demo cannot chain itself'); if (!get(c)) throw new Error(`no demo ${c} to chain`); }
  return save({ ...a, data: { ...a.data, chain: ids.slice(0, 20) } }, { reason: 'chain' });
}
/** walkthrough@1 of a demo and, after it, every demo in its chain (a tour), depth-limited. */
export function walkthrough(id, seen = new Set()) {
  const a = get(id); if (!a) throw new Error(`no demo ${id}`);
  seen.add(id);
  const w = R.demonstrationToWalkthrough(a);
  const steps = a.data.steps.map((s) => ({ say: s.say, do: s.do, target: s.target, ...(s.highlight ? { highlight: s.highlight } : {}), ...(s.title ? { title: s.title } : {}), ...(s.wait ? { wait: s.wait } : {}) }));
  const parts = [a.id];
  for (const c of a.data.chain ?? []) { if (seen.has(c) || !get(c)) continue; const n = walkthrough(c, seen); steps.push(...n.steps); parts.push(...n.parts); }
  return { ...w, steps: steps.slice(0, 400), parts, source: 'pitch' };
}

/* ---------------- media (recordings as clips) ---------------- */

const MIME_EXT = { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/x-matroska': 'mkv', 'audio/webm': 'weba' };

/** ffmpeg: AXF_FFMPEG, PATH, Playwright's own copy (PLAYWRIGHT_BROWSERS_PATH or ~/.cache/ms-playwright). '' when none. */
export function findFfmpeg() {
  const tryBin = (p) => { try { return p && existsSync(p) && spawnSync(p, ['-version'], { timeout: 5000 }).status === 0 ? p : ''; } catch { return ''; } };
  if (process.env.AXF_FFMPEG && tryBin(process.env.AXF_FFMPEG)) return process.env.AXF_FFMPEG;
  try { const r = spawnSync('ffmpeg', ['-version'], { timeout: 5000 }); if (r.status === 0) return 'ffmpeg'; } catch { /* not on PATH */ }
  for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache/ms-playwright')].filter(Boolean)) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base).filter((n) => n.startsWith('ffmpeg')).sort().reverse()) { const p = tryBin(join(base, d, 'ffmpeg-linux')); if (p) return p; }
  }
  return '';
}

/** Copy a recording in and register it as a clip@1 of the demo (transcript from the steps, keywords auto-extracted). */
export function addMedia(id, file, { seconds = 0, mime = '', recorded = {} } = {}) {
  const a = get(id); if (!a) throw new Error(`no demo ${id}`);
  if (!existsSync(file)) throw new Error(`no file ${file}`);
  const ext = MIME_EXT[mime] || extname(file).replace('.', '') || 'webm';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const name = `${id}-${stamp}.${ext}`;
  mkdirSync(dirOf('media'), { recursive: true });
  copyFileSync(file, join(dirOf('media'), name));
  const c = R.clipFromDemonstration(a, { video: `media/${name}`, seconds: Number(seconds) || 0 }, { at: new Date().toISOString(), app: 'console', ...recorded }, { kind: 'demo', at: new Date().toISOString() });
  const clipId = E.slugify(`${id}-${stamp.slice(4, 13).toLowerCase()}`, 'clip');
  const errors = R.demoAssetErrors('clip', c.data);
  if (errors.length) throw new Error(`clip: ${errors.join('; ')}`);
  const clip = { $axf: 'asset@1', type: 'clip', id: clipId, name: `${a.name} (recording)`, version: '1.0.0', description: c.description, author: 'Demonstration Designer', tags: ['clip', 'pitch', 'recording'], data: R.normalizeClip({ ...c.data, keywords: R.autoKeywords([c.data.keywords, 'pitch', 'recording', a.data.keywords], 200) }), updatedAt: new Date().toISOString() };
  writeJson(fileOf('clip', clipId), clip);
  pruneMedia(settings().export.keep);
  return { clip, file: join(dirOf('media'), name), bytes: statSync(join(dirOf('media'), name)).size };
}

/** Keep the newest `keep` recordings (clip + file); older ones go. */
export function pruneMedia(keep) {
  const clips = listKind('clip').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  for (const c of clips.slice(Math.max(1, keep))) {
    for (const k of ['video', 'poster']) { const p = c.data?.media?.[k]; if (p && !/^https:/.test(p) && existsSync(join(DATA_DIR, p))) rmSync(join(DATA_DIR, p)); }
    rmSync(fileOf('clip', c.id));
  }
}

export const listMedia = () => listKind('clip').map((c) => ({ id: c.id, name: c.name, demo: c.data?.source?.id ?? '', video: c.data?.media?.video ?? '', seconds: c.data?.media?.seconds ?? 0, recordedAt: c.data?.recorded?.at ?? '', mp4: /\.mp4$/.test(c.data?.media?.video ?? '') }));

/** A clip's recording as MP4 (H.264 + AAC) next to the original; needs ffmpeg. Returns { clip, mp4, ffmpeg }. */
export function exportMp4(clipId) {
  assertId(clipId);
  const f = fileOf('clip', clipId);
  if (!existsSync(f)) throw new Error(`no clip ${clipId}`);
  const c = readJson(f);
  const src = c.data?.media?.video ?? '';
  if (!src || /^https:/.test(src)) throw new Error('this clip has no recording file');
  if (/\.mp4$/.test(src)) return { clip: c, mp4: join(DATA_DIR, src), ffmpeg: '', already: true };
  const ff = findFfmpeg();
  if (!ff) throw new Error('no ffmpeg on this server: the recording stays WebM (set AXF_FFMPEG or install ffmpeg to get MP4)');
  const out = join(DATA_DIR, src.replace(/\.[a-z0-9]+$/, '.mp4'));
  const r = spawnSync(ff, ['-y', '-i', join(DATA_DIR, src), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', out], { encoding: 'utf8', timeout: 600000 });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`ffmpeg failed: ${(r.stderr || '').split('\n').filter(Boolean).slice(-3).join(' ').slice(-300)}`);
  c.data.media.video = src.replace(/\.[a-z0-9]+$/, '.mp4');
  c.updatedAt = new Date().toISOString();
  writeJson(f, c);
  return { clip: c, mp4: out, ffmpeg: ff };
}

export const share = (id, origin = '') => { assertId(id); if (!get(id)) throw new Error(`no demo ${id}`); return { id, path: E.shareLink('', id), play: E.shareLink('', id, { play: true }), url: origin ? E.shareLink(origin, id) : '', view: 'demonstration-designer' }; };

/* ---------------- CLI ---------------- */

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name, d = '') => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? d : d; };
  const has = (name) => rest.includes(name);
  const pos = rest.filter((x, i) => !x.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && !['--save', '--json'].includes(rest[i - 1])));
  const json = (v) => process.stdout.write(`${JSON.stringify(v, null, has('--json') ? 0 : 2)}\n`);
  if (!cmd || cmd === 'list') { const items = list(); if (has('--json')) json(items); else for (const a of items) console.log(`${a.id.padEnd(40)} ${String(a.steps).padStart(2)} steps  ${E.fmtSeconds(a.seconds).padEnd(12)} ${a.name}`); return 0; }
  if (cmd === 'topics') { const kind = flag('--kind'); const q = flag('--q'); let t = allTopics().filter((x) => !kind || x.kind === kind); if (q) t = E.searchTopics(t, q, 50); json(has('--json') ? t.map((x) => ({ id: x.id, kind: x.kind, label: x.label, description: x.description.slice(0, 200), screens: x.screens.map((s) => s.label) })) : t.map((x) => `${x.id}  ${x.label}`)); return 0; }
  if (cmd === 'generate') { json(generate(pos[0], { minutes: flag('--minutes') ? Number(flag('--minutes')) : undefined, narrator: flag('--voice') || undefined, speed: flag('--speed') ? Number(flag('--speed')) : undefined, save: has('--save'), build: flag('--build') })); return 0; }
  if (cmd === 'get') { const a = get(pos[0]); if (!a) { console.error(`demos: no demo ${pos[0]}`); return 2; } json(a); return 0; }
  if (cmd === 'save') { json(save(readJson(pos[0]))); return 0; }
  if (cmd === 'delete') { console.log(remove(pos[0]) ? `demos: removed ${pos[0]}` : 'demos: nothing to remove'); return 0; }
  if (cmd === 'script') { if (flag('--text')) { json(applyScript(pos[0], readFileSync(flag('--text'), 'utf8'))); return 0; } process.stdout.write(`${script(pos[0])}\n`); return 0; }
  if (cmd === 'chain') { json(summarize(setChain(pos[0], pos[1] ?? ''))); return 0; }
  if (cmd === 'walkthrough') { json(walkthrough(pos[0])); return 0; }
  if (cmd === 'share') { json(share(pos[0], flag('--origin'))); return 0; }
  if (cmd === 'media') {
    if (pos[0] === 'add') { const r = addMedia(pos[1], pos[2], { seconds: Number(flag('--seconds', 0)), mime: flag('--mime') }); json({ clip: r.clip.id, file: r.file, bytes: r.bytes, keywords: r.clip.data.keywords.length }); return 0; }
    if (pos[0] === 'export') { const r = exportMp4(pos[1]); json({ clip: r.clip.id, mp4: r.mp4, ffmpeg: r.ffmpeg || 'already mp4' }); return 0; }
    json(listMedia()); return 0;
  }
  if (cmd === 'settings') {
    if (pos[0] === 'set') { json(saveSettings(E.settingFromText(pos[1], pos[2]))); return 0; }
    if (has('--json')) { json(settings()); return 0; }
    for (const r of E.flattenSettings(settings())) console.log(`${r.key.padEnd(24)} ${JSON.stringify(r.value)}`);
    return 0;
  }
  if (cmd === 'ffmpeg') { console.log(findFfmpeg() || 'none'); return 0; }
  console.error('usage: demos.mjs topics | generate <topic> [--minutes N] [--voice v] [--save] | list | get <id> | save <file> | delete <id> | script <id> [--text f] | chain <id> <ids> | walkthrough <id> | media add|list|export | share <id> | settings [set k v]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exit(await main(process.argv.slice(2))); } catch (e) { console.error(`demos: ${e.message}`); process.exit(1); }
}
