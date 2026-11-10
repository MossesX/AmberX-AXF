/**
 * Voice intents as control-registry@1 contributions (build full-api-cli-control-of-everything-plus-an-offli, Nov 10 2026).
 * Two sources, both data once read, no model anywhere:
 *   - plugin.json `voice` (voice-intents@1): intents a plugin declares: phrases → an entry + action (or a ref to run);
 *   - AmberX `registerVoiceCommands(ID, [{ id, phrases, action, reply? }])` calls in apps/amberx-droid/src/plugins/*\/web:
 *     the same facts as code; scanned as text so the offline index carries them until they are declared as data.
 * The phrase resolver itself is the engine's (resolvePhrase: whole words, declared phrases, {param} slots) and agrees
 * with AmberX's voice core (`normalize` = `foldWords`): one phrase means the same on the phone and in the console.
 */
import { ID, VOICE_FRAME, foldPhrase, resolvePhrase } from '../../../../framework/core/engines/control-registry.mjs';

export { resolvePhrase, foldPhrase };
export const PHRASE_MAX = 80;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The voice-intents@1 block of a manifest, cleaned → { intents, errors }. Phrases are folded; bad intents are reported, never guessed. */
export function readVoiceIntents(manifest, { file = 'plugin.json' } = {}) {
  const errors = [];
  const v = isObj(manifest) ? manifest.voice : undefined;
  if (v === undefined) return { intents: [], errors, declared: false };
  if (!isObj(v) || v.$axf !== VOICE_FRAME) return { intents: [], errors: [`${file}: voice.$axf must be ${VOICE_FRAME}`], declared: true };
  const intents = [];
  (Array.isArray(v.intents) ? v.intents : []).forEach((raw, i) => {
    const it = isObj(raw) ? raw : {};
    const id = str(it.id, 120);
    const phrases = [...new Set((Array.isArray(it.phrases) ? it.phrases : []).map((p) => foldPhrase(p).slice(0, PHRASE_MAX)).filter(Boolean))];
    if (!id || !phrases.length) { errors.push(`${file}: voice.intents[${i}] needs an id and at least one phrase`); return; }
    const entry = str(it.entry, 200);
    if (entry && !ID.test(entry)) { errors.push(`${file}: voice.intents[${i}] (${id}): entry "${entry}" is not an entry id`); return; }
    if (!entry && !str(it.run, 400)) { errors.push(`${file}: voice.intents[${i}] (${id}) needs an entry or a run ref`); return; }
    intents.push({ id, phrases, ...(entry ? { entry } : {}), ...(str(it.action, 64) ? { action: str(it.action, 64) } : {}), ...(str(it.run, 400) ? { run: str(it.run, 400) } : {}),
      ...(isObj(it.params) ? { params: it.params } : {}), ...(str(it.reply, 200) ? { reply: str(it.reply, 200) } : {}), ...(it.needsAI === true ? { needsAI: true } : {}) });
  });
  return { intents, errors, declared: true };
}

/**
 * registerVoiceCommands calls in a source file → [{ id, phrases, action, reply?, line }]. Reads the object literals as
 * text (ids, phrases and actions are string literals there); anything computed is skipped and counted in `unread`.
 */
export function scanVoiceCommands(src, file = 'web/index.tsx') {
  const text = String(src ?? '');
  const out = []; const unread = [];
  const re = /registerVoiceCommands\(\s*[A-Za-z0-9_.]+\s*,\s*\[/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    let depth = 1; let i = start; let q = null;
    for (; i < text.length && depth > 0; i++) { const ch = text[i]; if (q) { if (ch === q && text[i - 1] !== '\\') q = null; continue; } if (ch === '"' || ch === "'" || ch === '`') q = ch; else if (ch === '[') depth++; else if (ch === ']') depth--; }
    const body = text.slice(start, i - 1);
    const line = text.slice(0, m.index).split('\n').length;
    for (const om of body.matchAll(/\{([^{}]*)\}/g)) {
      const o = om[1];
      const id = /\bid:\s*(['"`])([^'"`]+)\1/.exec(o)?.[2];
      const action = /\baction:\s*(['"`])([^'"`]*)\1/.exec(o)?.[2];
      const pm = /\bphrases:\s*\[([^\]]*)\]/.exec(o);
      const phrases = pm ? [...pm[1].matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((x) => foldPhrase(x[2].replace(/\\(.)/g, '$1')).slice(0, PHRASE_MAX)).filter(Boolean) : [];
      const reply = /\breply:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/.exec(o)?.[2];
      if (!id || !phrases.length || action === undefined) { unread.push({ file, line, why: `a voice command near line ${line} is not written as literals (id, phrases, action)` }); continue; }
      out.push({ id, phrases: [...new Set(phrases)], action, ...(reply ? { reply: reply.replace(/\\(.)/g, '$1') } : {}), line });
    }
  }
  return { commands: out, unread };
}

/**
 * Put intents on entries: a declared intent that names an entry adds its phrases to that entry's action (and params
 * presets become a second phrase form); one that names only a ref becomes a tool entry `<app>/tool/voice/<id>`;
 * AmberX scanned commands become `amberx-droid/tool/<plugin>/<id>` entries whose run is the action spec. → { entries, errors }.
 */
export function applyVoiceIntents(entries, intents, { app = 'console-web', folder = '', file = 'plugin.json' } = {}) {
  const errors = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const it of intents) {
    if (it.entry) {
      const e = byId.get(it.entry);
      if (!e) { errors.push(`${file}: voice intent ${it.id} names ${it.entry}, which is not in the registry`); continue; }
      const actionId = it.action ?? (e.type === 'page' ? 'open' : e.type === 'setting' ? 'set' : 'run');
      const a = e.actions.find((x) => x.id === actionId || x.aliases?.includes(actionId));
      if (!a) { errors.push(`${file}: voice intent ${it.id}: ${e.id} has no action ${actionId}`); continue; }
      const phrases = it.params && Object.keys(it.params).length ? it.phrases.map((p) => `${p}`) : it.phrases;
      byId.set(e.id, { ...e, actions: e.actions.map((x) => (x === a ? { ...x, phrases: [...new Set([...(x.phrases ?? []), ...phrases])], ...(it.params ? { presets: { ...(x.presets ?? {}), ...Object.fromEntries(phrases.map((p) => [p, it.params])) } } : {}), ...(it.needsAI ? { needsAI: true } : {}) } : x)), source: { ...e.source, frame: e.source.frame ?? VOICE_FRAME } });
      continue;
    }
    const id = `${app}/tool/${folder || 'voice'}/${it.id}`;
    if (!ID.test(id)) { errors.push(`${file}: voice intent ${it.id} makes no entry id`); continue; }
    byId.set(id, { id, type: 'tool', owner: app, label: it.phrases[0], description: it.reply ? `Says: ${it.reply}` : `Voice intent ${it.id}`, where: { app, ...(folder ? { plugin: folder } : {}), file },
      actions: [{ id: 'run', effect: 'write', run: it.run, phrases: it.phrases, ...(it.needsAI ? { needsAI: true } : {}) }], aliases: [it.id], surfaces: { voice: it.phrases, ...(app === 'console-web' ? {} : { rest: false, mcp: false }) },
      ...(app === 'console-web' ? {} : { gaps: [{ what: 'rest', why: `runs inside ${app}; reached over its app channel (step s13)`, plan: 'full-api-cli-control s13' }, { what: 'mcp', why: `runs inside ${app}; reached over its app channel (step s13)`, plan: 'full-api-cli-control s13' }] }),
      source: { kind: 'voice', file, frame: VOICE_FRAME } });
  }
  return { entries: [...byId.values()], errors };
}
