/**
 * voice-command rules — voice-command@1 (Brett, Nov 4 2026: "it needs to build in voice commands for the API and MCP
 * and CLI automatically, so they can be added to Molly and controlled by voice"). An app's voice commands are one
 * asset in the asset@1 envelope: for every command the app exposes through its API, MCP tools, CLI or web actions,
 * the phrases a person may say (with `{slot}` placeholders), the slots (type, required, choices), the confirmation
 * rule, how the command runs on each transport, and what to answer. Generated from the app's command surface
 * (`generateVoiceCommands`), hand-tuned where an app wants nicer phrasing (`source: authored`, kept across
 * regeneration by `mergeVoiceCommands`), listed by "what can I say in <app>?" (`whatCanISay`), matched by Molly's
 * listener (`matchUtterance`).
 *
 * ONE registry (effects, confirm floors, slot types, transports, verbs) drives both validators (core/validate.ts and
 * the build engine), the normalizer, the generator, the matcher and the help. Pure: no I/O, no DOM, no clock of its
 * own (`now` is passed in). Unknown fields are dropped (open registry: later work adds slot types, transports and
 * verbs here, never a new type). Kotlin twin deferred (Android on hold, spec/PORTING.md).
 *
 * Confirmation rules (the contract): a read or a navigation never asks; a write runs at once when every required slot
 * was heard and asks only for what is missing (`missing`); a destructive command always asks ("delete entry 12?" →
 * "yes"). A command may ask more than its effect's floor, never less.
 */

export const VOICE_COMMAND_TYPE = 'voice-command';
export const VOICE_COMMAND_FRAME = 'voice-command@1';
/** = control@1 / plugin-commands@1 effects. */
export const VOICE_EFFECTS = ['read', 'write', 'destructive', 'navigate'];
export const VOICE_CONFIRMS = ['never', 'missing', 'always'];
/** The confirm floor per effect: a command may ask more, never less. */
export const VOICE_CONFIRM_FLOOR = { read: 'never', navigate: 'never', write: 'missing', destructive: 'always' };
export const VOICE_SLOT_TYPES = ['text', 'number', 'money', 'date', 'choice', 'id', 'yesno'];
/** Where a command runs: a REST route ("POST /api/x"), an MCP tool name, a CLI line, a web action id in the open app. */
export const VOICE_TRANSPORTS = ['api', 'mcp', 'cli', 'action'];
export const VOICE_SOURCES = ['generated', 'authored', 'mixed'];
export const VOICE_LIMITS = { commands: 1500, phrases: 12, slots: 12, phrase: 120, wake: 6, title: 120, say: 200, help: 200, options: 40 };
/** Words that answer a confirm question. */
export const VOICE_YES = ['yes', 'yeah', 'yep', 'yup', 'confirm', 'confirmed', 'do it', 'go ahead', 'ok', 'okay', 'sure', 'bet', 'say less'];
export const VOICE_NO = ['no', 'nope', 'cancel', 'stop', 'never mind', 'nevermind', 'forget it', 'abort'];
/** Filler words a person may add that a phrase need not spell out. */
export const VOICE_FILLERS = ['a', 'an', 'the', 'to', 'for', 'of', 'please', 'me', 'my', 'in', 'on', 'at', 'with', 'and', 'then', 'now', 'hey', 'uh', 'um'];
/** The verb at the front of a command id or title → its effect when the surface gives none. */
export const VOICE_VERB_EFFECT = {
  list: 'read', get: 'read', show: 'read', find: 'read', search: 'read', export: 'read', totals: 'read', total: 'read', count: 'read', read: 'read', status: 'read', what: 'read', info: 'read', check: 'read', accounts: 'read', history: 'read',
  open: 'navigate', go: 'navigate', back: 'navigate', focus: 'navigate', switch: 'navigate', navigate: 'navigate',
  delete: 'destructive', remove: 'destructive', clear: 'destructive', purge: 'destructive', drop: 'destructive', uninstall: 'destructive',
};
/** Action words a command id or title may start (or end) with; the generator puts the verb first ("totals_get" → "get totals"). */
export const VOICE_VERBS = ['list', 'get', 'show', 'find', 'search', 'export', 'count', 'read', 'check', 'open', 'go', 'back', 'focus', 'switch', 'navigate', 'delete', 'remove', 'clear', 'purge', 'drop', 'uninstall', 'add', 'create', 'new', 'set', 'edit', 'update', 'change', 'run', 'start', 'stop', 'send', 'make', 'import', 'save', 'load', 'move', 'approve', 'deny', 'park', 'step', 'done', 'finish', 'close', 'reopen', 'restore', 'play', 'pause', 'record', 'reload', 'refresh', 'toggle', 'enable', 'disable', 'pick', 'select', 'assign', 'book', 'hire', 'fire', 'note', 'tag', 'pin', 'unpin', 'archive', 'copy', 'paste', 'cut', 'undo', 'redo', 'rename', 'sort', 'filter', 'group', 'reset', 'install', 'submit', 'launch', 'act'];
/** Slot name hints → slot type, for generated commands whose input schema says only "string" or "number". */
export const VOICE_SLOT_HINTS = [[/(amount|price|cost|total|budget|usd|cents)$/i, 'money'], [/(date|day|when|from|to|since|until)$/i, 'date'], [/(^id$|_id$|Id$|entry|ref)$/i, 'id']];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const COMMAND_ID = /^[a-z][a-z0-9_.-]{0,63}$/;
const SLOT_NAME = /^[a-z][a-zA-Z0-9]{0,29}$/;
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const uniq = (a) => [...new Set(a)];
const words = (s) => str(s, 4000).toLowerCase().replace(/[^a-z0-9$#.:/\-{}\s]/g, ' ').replace(/(\d)\.(?!\d)/g, '$1 ').split(/\s+/).filter(Boolean);
const titleCase = (s) => s.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());

/** The `{slot}` names a phrase or answer uses. */
export function phraseSlots(text) { return uniq([...str(text, 4000).matchAll(PLACEHOLDER)].map((m) => m[1])); }

/** Phrase → tokens: words and slots, in order. */
export function tokenizePhrase(phrase) {
  const out = [];
  for (const w of words(phrase)) {
    const m = /^\{([a-zA-Z][a-zA-Z0-9]*)\}$/.exec(w);
    if (m) out.push({ kind: 'slot', name: m[1] });
    else if (w.includes('{')) for (const part of w.split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/).filter(Boolean)) out.push(/^\{/.test(part) ? { kind: 'slot', name: part.slice(1, -1) } : { kind: 'word', text: part });
    else out.push({ kind: 'word', text: w });
  }
  return out;
}

/** The confirm rule a command really has: its own, raised to its effect's floor. */
export function confirmRule(command) {
  const floor = VOICE_CONFIRM_FLOOR[command?.effect] ?? 'missing';
  const own = VOICE_CONFIRMS.includes(command?.confirm) ? command.confirm : floor;
  return VOICE_CONFIRMS.indexOf(own) >= VOICE_CONFIRMS.indexOf(floor) ? own : floor;
}

/* ================================================================== validation */

function slotErrors(name, s, at) {
  const e = [];
  if (!SLOT_NAME.test(name)) e.push(`${at}: slot "${name}" must be a camelCase name (letters and digits)`);
  if (!isObj(s)) return [`${at}.${name} must be { type, required?, options?, say?, default? }`];
  if (!VOICE_SLOT_TYPES.includes(s.type)) e.push(`${at}.${name}.type must be one of ${VOICE_SLOT_TYPES.join(', ')}`);
  if (s.required !== undefined && typeof s.required !== 'boolean') e.push(`${at}.${name}.required must be true or false`);
  if (s.type === 'choice' && (!Array.isArray(s.options) || !s.options.length || s.options.length > VOICE_LIMITS.options || s.options.some((o) => !str(o, 60)))) e.push(`${at}.${name}.options must list 1 to ${VOICE_LIMITS.options} choices`);
  if (s.say !== undefined && typeof s.say !== 'string') e.push(`${at}.${name}.say must be a string`);
  return e;
}

export function voiceCommandErrors(type, raw) {
  if (type !== VOICE_COMMAND_TYPE) return [];
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  if (!SLUG.test(raw.app ?? '')) e.push('data.app is the app (its project manifest name: lowercase letters, digits and dashes)');
  if (raw.forFramework !== undefined && typeof raw.forFramework !== 'boolean') e.push('data.forFramework must be true or false');
  if (raw.source !== undefined && !VOICE_SOURCES.includes(raw.source)) e.push(`data.source must be one of ${VOICE_SOURCES.join(', ')}`);
  if (raw.wake !== undefined && (!Array.isArray(raw.wake) || raw.wake.length > VOICE_LIMITS.wake || raw.wake.some((w) => !/^[a-z][a-z0-9 -]{0,30}$/.test(w ?? '')))) e.push(`data.wake must be up to ${VOICE_LIMITS.wake} lowercase names a phrase may start with`);
  if (raw.generatedFrom !== undefined && (!Array.isArray(raw.generatedFrom) || raw.generatedFrom.some((t) => !VOICE_TRANSPORTS.includes(t)))) e.push(`data.generatedFrom lists transports: ${VOICE_TRANSPORTS.join(', ')}`);
  if (!Array.isArray(raw.commands)) { e.push('data.commands must be a list of commands'); return e; }
  if (raw.commands.length > VOICE_LIMITS.commands) e.push(`data.commands holds more than ${VOICE_LIMITS.commands} commands`);
  const ids = new Set();
  raw.commands.forEach((c, i) => {
    const at = `data.commands[${i}]`;
    if (!isObj(c)) { e.push(`${at} must be an object`); return; }
    if (!COMMAND_ID.test(c.id ?? '')) e.push(`${at}.id must be a command id (lowercase letters, digits, _ . -)`);
    else if (ids.has(c.id)) e.push(`${at}.id "${c.id}" is declared twice`);
    ids.add(c.id);
    if (!str(c.title, VOICE_LIMITS.title + 1) || c.title.length > VOICE_LIMITS.title) e.push(`${at}.title is what the command is called (up to ${VOICE_LIMITS.title} characters)`);
    if (!VOICE_EFFECTS.includes(c.effect)) e.push(`${at}.effect must be one of ${VOICE_EFFECTS.join(', ')}`);
    else if (c.confirm !== undefined) {
      if (!VOICE_CONFIRMS.includes(c.confirm)) e.push(`${at}.confirm must be one of ${VOICE_CONFIRMS.join(', ')}`);
      else if (VOICE_CONFIRMS.indexOf(c.confirm) < VOICE_CONFIRMS.indexOf(VOICE_CONFIRM_FLOOR[c.effect])) e.push(`${at}.confirm "${c.confirm}" is below the floor for a ${c.effect} command ("${VOICE_CONFIRM_FLOOR[c.effect]}")`);
    }
    if (!isObj(c.run) || !VOICE_TRANSPORTS.some((t) => str(c.run[t], 400))) e.push(`${at}.run must name at least one transport (${VOICE_TRANSPORTS.join(', ')}) and how the command runs there`);
    else for (const [t, v] of Object.entries(c.run)) { if (!VOICE_TRANSPORTS.includes(t)) e.push(`${at}.run.${t} is not a transport`); else if (typeof v !== 'string' || !v.trim() || v.length > 400) e.push(`${at}.run.${t} must be a short string`); }
    const slots = isObj(c.slots) ? c.slots : {};
    if (c.slots !== undefined && !isObj(c.slots)) e.push(`${at}.slots must be an object of { name: slot }`);
    if (Object.keys(slots).length > VOICE_LIMITS.slots) e.push(`${at}.slots holds more than ${VOICE_LIMITS.slots} slots`);
    for (const [n, s] of Object.entries(slots)) e.push(...slotErrors(n, s, `${at}.slots`));
    if (!Array.isArray(c.phrases) || !c.phrases.length) e.push(`${at}.phrases must list at least one phrase to say (with {slot} placeholders)`);
    else {
      if (c.phrases.length > VOICE_LIMITS.phrases) e.push(`${at}.phrases holds more than ${VOICE_LIMITS.phrases} phrases`);
      c.phrases.forEach((p, j) => {
        if (typeof p !== 'string' || !p.trim() || p.length > VOICE_LIMITS.phrase) { e.push(`${at}.phrases[${j}] must be a phrase of up to ${VOICE_LIMITS.phrase} characters`); return; }
        const toks = tokenizePhrase(p);
        if (!toks.some((t) => t.kind === 'word')) e.push(`${at}.phrases[${j}] needs at least one word (not only slots)`);
        for (const n of phraseSlots(p)) if (!slots[n]) e.push(`${at}.phrases[${j}] uses {${n}}, which is not a declared slot`);
        // two free-text slots in a row cannot be told apart; a typed slot (money, date, choice…) delimits itself
        for (let k = 1; k < toks.length; k++) if (toks[k].kind === 'slot' && toks[k - 1].kind === 'slot' && (slots[toks[k - 1].name]?.type ?? 'text') === 'text' && (slots[toks[k].name]?.type ?? 'text') === 'text') e.push(`${at}.phrases[${j}]: a text slot {${toks[k - 1].name}} cannot be followed straight by another text slot {${toks[k].name}} (put a word between them)`);
      });
    }
    if (c.say !== undefined) {
      if (typeof c.say !== 'string' || c.say.length > VOICE_LIMITS.say) e.push(`${at}.say must be a sentence of up to ${VOICE_LIMITS.say} characters`);
      else for (const n of phraseSlots(c.say)) if (n !== 'result' && n !== 'title' && !slots[n]) e.push(`${at}.say uses {${n}}, which is neither a slot nor {result}`);
    }
    if (c.help !== undefined && (typeof c.help !== 'string' || c.help.length > VOICE_LIMITS.help)) e.push(`${at}.help must be a line of up to ${VOICE_LIMITS.help} characters`);
    if (c.source !== undefined && !['generated', 'authored'].includes(c.source)) e.push(`${at}.source must be generated or authored`);
  });
  return e;
}

/** Defaults filled, unknown fields dropped. Never throws: a bad command is kept as far as it goes (validate first). */
export function normalizeVoiceCommands(raw) {
  const o = isObj(raw) ? raw : {};
  const commands = (Array.isArray(o.commands) ? o.commands : []).filter(isObj).map((c) => {
    const slots = {};
    for (const [n, s] of Object.entries(isObj(c.slots) ? c.slots : {})) if (isObj(s)) slots[n] = { type: VOICE_SLOT_TYPES.includes(s.type) ? s.type : 'text', required: s.required === true, ...(s.type === 'choice' ? { options: (Array.isArray(s.options) ? s.options : []).map((x) => str(x, 60)).filter(Boolean) } : {}), say: str(s.say, 80) || n, ...(s.default !== undefined ? { default: s.default } : {}) };
    const effect = VOICE_EFFECTS.includes(c.effect) ? c.effect : 'write';
    const run = {}; for (const t of VOICE_TRANSPORTS) if (str(c.run?.[t], 400)) run[t] = str(c.run[t], 400);
    return { id: str(c.id, 64), title: str(c.title, VOICE_LIMITS.title), effect, confirm: confirmRule({ effect, confirm: c.confirm }), run, slots, phrases: (Array.isArray(c.phrases) ? c.phrases : []).map((p) => str(p, VOICE_LIMITS.phrase)).filter(Boolean), say: str(c.say, VOICE_LIMITS.say), help: str(c.help, VOICE_LIMITS.help), source: c.source === 'authored' ? 'authored' : 'generated' };
  });
  return { app: str(o.app, 63), forFramework: o.forFramework === true, source: VOICE_SOURCES.includes(o.source) ? o.source : 'generated', generatedFrom: (Array.isArray(o.generatedFrom) ? o.generatedFrom : []).filter((t) => VOICE_TRANSPORTS.includes(t)), wake: (Array.isArray(o.wake) && o.wake.length ? o.wake : [str(o.app, 63)]).map((w) => str(w, 31).toLowerCase()).filter(Boolean), commands };
}

/* ================================================================== slot values */

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dayShift = (now, days) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + days); return isoDate(d); };

/** Parses the words a slot was given. Returns { value, used } (how many words it took) or null. */
export function parseSlotValue(slot, ws, now = '2026-01-01T00:00:00.000Z') {
  const t = slot?.type ?? 'text';
  const w0 = ws[0];
  if (w0 === undefined) return null;
  if (t === 'money') {
    const m = /^\$?(\d+(?:\.\d{1,2})?)$/.exec(w0);
    if (!m) return null;
    let value = Number(m[1]); let used = 1;
    if (/^(dollars?|bucks?|usd)$/.test(ws[1] ?? '')) { used = 2; if (ws[2] === 'and' && /^\d{1,2}$/.test(ws[3] ?? '') && /^cents?$/.test(ws[4] ?? '')) { value += Number(ws[3]) / 100; used = 5; } else if (/^\d{1,2}$/.test(ws[2] ?? '') && /^cents?$/.test(ws[3] ?? '')) { value += Number(ws[2]) / 100; used = 4; } }
    else if (/^cents?$/.test(ws[1] ?? '')) { value = value / 100; used = 2; }
    return { value: Math.round(value * 100) / 100, used };
  }
  if (t === 'number') { const m = /^-?\d+(?:\.\d+)?$/.exec(w0); return m ? { value: Number(w0), used: 1 } : null; }
  if (t === 'yesno') { if (VOICE_YES.includes(w0)) return { value: true, used: 1 }; if (VOICE_NO.includes(w0)) return { value: false, used: 1 }; return null; }
  if (t === 'id') return /^[a-z0-9][a-z0-9_.:-]*$/.test(w0) && !VOICE_FILLERS.includes(w0) ? { value: w0, used: 1 } : null;
  if (t === 'choice') {
    const opts = (slot.options ?? []).map((o) => ({ o, ws: words(o) }));
    for (const { o, ws: ow } of opts.sort((a, b) => b.ws.length - a.ws.length)) if (ow.length && ow.every((x, i) => ws[i] === x)) return { value: o, used: ow.length };
    return null;
  }
  if (t === 'date') {
    if (w0 === 'today') return { value: dayShift(now, 0), used: 1 };
    if (w0 === 'yesterday') return { value: dayShift(now, -1), used: 1 };
    if (w0 === 'tomorrow') return { value: dayShift(now, 1), used: 1 };
    if (/^\d{4}-\d{2}-\d{2}$/.test(w0)) return { value: w0, used: 1 };
    const md = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(w0);
    if (md) { const y = md[3] ? (md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3])) : new Date(now).getUTCFullYear(); return { value: `${y}-${pad(md[1])}-${pad(md[2])}`, used: 1 }; }
    const mi = MONTHS.findIndex((m) => m === w0 || m.slice(0, 3) === w0);
    const dm = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(ws[1] ?? '');
    if (mi >= 0 && dm) { const y = /^\d{4}$/.test(ws[2] ?? '') ? Number(ws[2]) : new Date(now).getUTCFullYear(); return { value: `${y}-${pad(mi + 1)}-${pad(dm[1])}`, used: /^\d{4}$/.test(ws[2] ?? '') ? 3 : 2 }; }
    return null;
  }
  return null; // text is captured by the matcher (it needs the next literal to know where to stop)
}

/* ================================================================== matching */

/** One phrase against the utterance words. Returns { slots, literals, leftover } or null. */
export function matchPhrase(tokens, ws, slots, now) {
  const got = {};
  const go = (ti, wi, literals) => {
    if (ti === tokens.length) return { slots: { ...got }, literals, leftover: ws.slice(wi) };
    const tok = tokens[ti];
    if (tok.kind === 'word') {
      if (ws[wi] === tok.text) return go(ti + 1, wi + 1, literals + 1);
      if (wi < ws.length && VOICE_FILLERS.includes(ws[wi]) && !tokens.slice(ti).some((t) => t.kind === 'word' && t.text === ws[wi])) return go(ti, wi + 1, literals);
      return null;
    }
    const slot = slots[tok.name] ?? { type: 'text' };
    if (slot.type !== 'text') {
      const v = parseSlotValue(slot, ws.slice(wi), now);
      if (!v) return null;
      got[tok.name] = v.value; const r = go(ti + 1, wi + v.used, literals); if (r) return r; delete got[tok.name]; return null;
    }
    const next = tokens[ti + 1];
    let start = wi;
    while (start < ws.length && VOICE_FILLERS.includes(ws[start])) start++; // "add an expense of dunkin" → "dunkin"
    for (let len = 1; start + len <= ws.length; len++) {
      const chunk = ws.slice(start, start + len);
      if (next?.kind === 'word' && ws[start + len] !== next.text && start + len < ws.length) continue;
      if (chunk.every((x) => VOICE_FILLERS.includes(x))) continue;
      got[tok.name] = chunk.join(' ');
      const r = go(ti + 1, start + len, literals);
      if (r) return r;
    }
    delete got[tok.name];
    return null;
  };
  return go(0, 0, 0);
}

/** Trailing "<slot name> <value>" pairs for slots the phrase did not carry ("… category food date yesterday"). */
function takeTail(ws, command, got, now) {
  const slots = command.slots ?? {};
  let i = 0;
  while (i < ws.length) {
    if (VOICE_FILLERS.includes(ws[i])) { i++; continue; }
    let name = Object.keys(slots).find((n) => n.toLowerCase() === ws[i] || words(slots[n].say ?? '')[0] === ws[i]);
    if (!name) {
      // a bare value ("… 5 dollars", "… yesterday", "… food") goes to the first empty typed slot that reads it; text never
      const open = Object.keys(slots).filter((n) => got[n] === undefined && slots[n].type !== 'text');
      const fit = ['money', 'number', 'date', 'choice', 'yesno', 'id'].flatMap((t) => open.filter((n) => slots[n].type === t)).find((n) => parseSlotValue(slots[n], ws.slice(i), now));
      if (!fit) return false;
      const v = parseSlotValue(slots[fit], ws.slice(i), now);
      got[fit] = v.value; i += v.used; continue;
    }
    const slot = slots[name];
    if (slot.type === 'text') { const stop = ws.slice(i + 1).findIndex((w) => Object.keys(slots).some((n) => n.toLowerCase() === w || words(slots[n].say ?? '')[0] === w)); const chunk = stop < 0 ? ws.slice(i + 1) : ws.slice(i + 1, i + 1 + stop); if (!chunk.length) return false; got[name] = chunk.join(' '); i += 1 + chunk.length; continue; }
    const v = parseSlotValue(slot, ws.slice(i + 1), now);
    if (!v) return false;
    got[name] = v.value; i += 1 + v.used;
  }
  return true;
}

/** Strips a leading wake word ("expenses, add …") or a trailing "in expenses"; returns the app it named, if any. */
export function splitWake(ws, assets) {
  for (const a of assets) for (const w of a.wake ?? [a.app]) {
    const ww = words(w);
    if (ww.length && ww.every((x, i) => ws[i] === x)) return { app: a.app, ws: ws.slice(ww.length) };
    if (ws.length > ww.length + 1 && ws[ws.length - ww.length - 1] === 'in' && ww.every((x, i) => ws[ws.length - ww.length + i] === x)) return { app: a.app, ws: ws.slice(0, ws.length - ww.length - 1) };
  }
  return { app: '', ws };
}

/**
 * The best command for what was said, across one app's commands or many apps'. Returns null when nothing fits,
 * else { app, command, slots, missing (required slots not heard), confirm (ask before running?), question, score }.
 */
export function matchUtterance(assetsOrOne, text, { now = '2026-01-01T00:00:00.000Z', app = '' } = {}) {
  const assets = (Array.isArray(assetsOrOne) ? assetsOrOne : [assetsOrOne]).map(normalizeVoiceCommands);
  const all = words(text);
  if (!all.length) return null;
  const w = splitWake(all, assets);
  const only = w.app || app;
  let best = null;
  for (const a of assets) {
    if (only && a.app !== only) continue;
    for (const c of a.commands) for (const p of c.phrases) {
      const m = matchPhrase(tokenizePhrase(p), w.ws, c.slots, now);
      if (!m) continue;
      const got = { ...m.slots };
      if (m.leftover.length && !takeTail(m.leftover, c, got, now)) continue;
      const score = m.literals * 10 + Object.keys(got).length * 3 - (w.ws.length - m.literals - Object.keys(got).length) + (c.source === 'authored' ? 1 : 0);
      if (!best || score > best.score) best = { app: a.app, command: c, slots: got, score, phrase: p };
    }
  }
  if (!best) return null;
  for (const [n, s] of Object.entries(best.command.slots)) if (best.slots[n] === undefined && s.default !== undefined) best.slots[n] = s.default === 'today' && s.type === 'date' ? dayShift(now, 0) : s.default;
  const missing = Object.entries(best.command.slots).filter(([n, s]) => s.required && best.slots[n] === undefined).map(([n]) => n);
  const rule = confirmRule(best.command);
  const confirm = rule === 'always' || (rule === 'missing' && missing.length > 0);
  const question = missing.length ? `What is ${best.command.slots[missing[0]].say || missing[0]}?` : rule === 'always' ? `${best.command.title}${Object.keys(best.slots).length ? ' (' + Object.entries(best.slots).map(([k, v]) => `${k}: ${v}`).join(', ') + ')' : ''}. Yes or no?` : '';
  return { app: best.app, command: best.command, slots: best.slots, missing, confirm, question, score: best.score, phrase: best.phrase };
}

/** Is this an answer to a confirm question? true / false / null (neither). */
export function yesOrNo(text) {
  const s = words(text).join(' ');
  if (!s) return null;
  if (VOICE_YES.some((y) => s === y || s.startsWith(y + ' '))) return true;
  if (VOICE_NO.some((n) => s === n || s.startsWith(n + ' '))) return false;
  return null;
}

/** The answer sentence: the command's `say` with slots and {result} filled, else a plain one. */
export function sayFor(command, slots = {}, result = '') {
  const tpl = command?.say || (command?.effect === 'read' ? '{title}: {result}' : '{title}: done.');
  return tpl.replace(PLACEHOLDER, (m, n) => (n === 'result' ? String(result ?? '') : n === 'title' ? command?.title ?? '' : slots[n] !== undefined ? String(slots[n]) : m)).replace(/\s+/g, ' ').trim();
}

/* ================================================================== help */

const exampleFor = (s, n) => s.type === 'money' ? '12.50' : s.type === 'number' ? '3' : s.type === 'date' ? 'today' : s.type === 'choice' ? (s.options?.[0] ?? n) : s.type === 'yesno' ? 'yes' : s.type === 'id' ? 'abc123' : `<${s.say || n}>`;

/** One command as a person reads it: its phrases with <slot> markers and an example. */
export function helpFor(command) {
  const c = normalizeVoiceCommands({ app: 'x', commands: [command] }).commands[0];
  const shown = c.phrases.map((p) => p.replace(PLACEHOLDER, (m, n) => `<${c.slots[n]?.say || n}>`));
  const example = (c.phrases[0] ?? '').replace(PLACEHOLDER, (m, n) => exampleFor(c.slots[n] ?? { type: 'text' }, n));
  return { id: c.id, title: c.title, effect: c.effect, confirm: c.confirm, phrases: shown, example, help: c.help || `${c.title}: say "${example}"` };
}

/** "What can I say in <app>?" → lines, reads first, then writes, then destructive ones (marked), then navigation. */
export function whatCanISay(assetsOrOne, app = '') {
  const assets = (Array.isArray(assetsOrOne) ? assetsOrOne : [assetsOrOne]).map(normalizeVoiceCommands).filter((a) => !app || a.app === app);
  const order = ['read', 'write', 'destructive', 'navigate'];
  const lines = [];
  for (const a of assets) {
    const cs = [...a.commands].sort((x, y) => order.indexOf(x.effect) - order.indexOf(y.effect) || x.title.localeCompare(y.title));
    lines.push({ app: a.app, header: `In ${titleCase(a.app.replace(/-/g, ' '))} you can say:`, commands: cs.map((c) => { const h = helpFor(c); return { id: c.id, line: `"${h.example}" — ${c.title}${c.effect === 'destructive' ? ' (asks first)' : c.effect === 'write' ? ' (asks only for what is missing)' : ''}` }; }) });
  }
  return lines;
}

/* ================================================================== generation from a command surface */

/**
 * A command surface entry (what an app's API / MCP / CLI / actions already declare):
 *   { id, title?, description?, effect?, run: { api?, mcp?, cli?, action? }, input?: { properties?: { name: { type?, enum?, description?, format? } }, required?: [] } }
 */
export function slotFromProperty(name, p = {}) {
  let type = 'text';
  if (Array.isArray(p.enum) && p.enum.length) type = 'choice';
  else if (p.type === 'boolean') type = 'yesno';
  else if (p.format === 'date' || p.format === 'date-time') type = 'date';
  else if (p.type === 'number' || p.type === 'integer') type = 'number';
  const hint = VOICE_SLOT_HINTS.find(([re]) => re.test(name));
  if (hint && (type === 'text' || (type === 'number' && hint[1] === 'money'))) type = hint[1];
  const say = str(p.description, 80).split(/[.(:;]/)[0].trim().toLowerCase() || name.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
  return { type, say, ...(type === 'choice' ? { options: p.enum.map((x) => String(x)) } : {}) };
}

/** The verb and the rest of a command id with the app prefix removed: "expenses_add" → ["add"], "entries.list" → ["list", "entries"]. */
export function idWords(id, app = '') {
  let ws = str(id, 64).toLowerCase().split(/[_.\-/]+/).filter(Boolean);
  const ap = words(app.replace(/-/g, ' '));
  if (ap.length && ap.every((x, i) => ws[i] === x)) ws = ws.slice(ap.length);
  if (!ws.length) ws = ['run'];
  const vi = ws.findIndex((w) => VOICE_VERBS.includes(w));
  return vi > 0 ? [ws[vi], ...ws.slice(0, vi), ...ws.slice(vi + 1)] : ws;
}

/** The effect of a surface command: declared, else from its verb (control@1 ops count as verbs), else write. */
export function effectOf(entry, app = '') {
  if (VOICE_EFFECTS.includes(entry?.effect)) return entry.effect;
  if (entry?.readOnly === true) return 'read';
  if (entry?.destructive === true) return 'destructive';
  const first = idWords(entry?.id ?? '', app)[0];
  if (first in VOICE_VERB_EFFECT) return VOICE_VERB_EFFECT[first];
  const tw = words(entry?.title ?? '')[0];
  if (tw in VOICE_VERB_EFFECT) return VOICE_VERB_EFFECT[tw];
  const m = /^(GET|DELETE)\b/i.exec(entry?.run?.api ?? '');
  if (m) return m[1].toUpperCase() === 'GET' ? 'read' : 'destructive';
  return 'write';
}

/** One generated voice command from one surface entry. */
export function generateCommand(entry, app = '') {
  const id = str(entry?.id, 64).toLowerCase();
  const iw = idWords(id, app);
  const title = str(entry?.title, VOICE_LIMITS.title) || titleCase(iw.join(' '));
  const effect = effectOf(entry, app);
  const props = isObj(entry?.input?.properties) ? entry.input.properties : {};
  const required = Array.isArray(entry?.input?.required) ? entry.input.required.filter((r) => props[r] !== undefined) : [];
  const slots = {};
  for (const [n, p] of Object.entries(props).slice(0, VOICE_LIMITS.slots)) if (SLOT_NAME.test(n)) slots[n] = { ...slotFromProperty(n, isObj(p) ? p : {}), required: required.includes(n), ...(isObj(p) && p.default !== undefined ? { default: p.default } : {}) };
  const req = required.filter((n) => slots[n]);
  // two text slots in a row cannot be heard apart: keep the declared order, and offer the typed-first order too
  const typedFirst = [...req].sort((a, b) => (slots[a].type === 'text' ? 1 : 0) - (slots[b].type === 'text' ? 1 : 0));
  // two text slots in a row get the second one's name between them ("{path} value {value}")
  const tailOf = (o) => o.map((n, i) => (i > 0 && slots[o[i - 1]].type === 'text' && slots[n].type === 'text' ? `${words(slots[n].say)[0] || n.toLowerCase()} {${n}}` : `{${n}}`)).join(' ');
  const tails = uniq([req, typedFirst].map(tailOf));
  const base = words(title).filter((w) => !/[{}]/.test(w)).join(' ');
  const short = iw.join(' ');
  const noun = ['get', 'list', 'show'].includes(iw[0]) && iw.length > 1 ? iw.slice(1).join(' ') : '';
  const phrases = uniq([
    ...tails.map((tail) => `${base}${tail ? ' ' + tail : ''}`),
    ...(short !== base ? tails.map((tail) => `${short}${tail ? ' ' + tail : ''}`) : []),
    ...(tails[0] && req.length === 1 && ['money', 'number'].includes(slots[req[0]].type) ? [`${base} of ${tails[0]}`] : []),
    ...(noun ? [noun] : []),
    base, // the bare title: the missing slots get asked for
  ].map((p) => p.replace(/\s+/g, ' ').trim()).filter((p, i, arr) => p && arr.indexOf(p) === i && tokenizePhrase(p).some((t) => t.kind === 'word')).slice(0, VOICE_LIMITS.phrases));
  const run = {}; for (const t of VOICE_TRANSPORTS) if (str(entry?.run?.[t], 400)) run[t] = str(entry.run[t], 400);
  const c = { id, title, effect, confirm: VOICE_CONFIRM_FLOOR[effect], run, slots, phrases, say: effect === 'read' ? '{title}: {result}' : `${title}: done.`, help: str(entry?.description, VOICE_LIMITS.help), source: 'generated' };
  return c;
}

/** The whole asset data for an app's command surface { app, forFramework?, wake?, commands: [entry…] }. */
export function generateVoiceCommands(surface) {
  const app = str(surface?.app, 63);
  const seen = new Set();
  const commands = (Array.isArray(surface?.commands) ? surface.commands : []).filter((e) => isObj(e) && COMMAND_ID.test(str(e.id, 64).toLowerCase())).map((e) => generateCommand(e, app)).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const generatedFrom = uniq(commands.flatMap((c) => Object.keys(c.run)));
  return normalizeVoiceCommands({ app, forFramework: surface?.forFramework === true, source: 'generated', generatedFrom, wake: surface?.wake, commands });
}

/** Regeneration keeps what a person tuned: authored commands stay as they are, generated ones follow the surface. */
export function mergeVoiceCommands(existing, generated) {
  const ex = normalizeVoiceCommands(existing); const gen = normalizeVoiceCommands(generated);
  const authored = new Map(ex.commands.filter((c) => c.source === 'authored').map((c) => [c.id, c]));
  const commands = gen.commands.map((c) => authored.get(c.id) ?? c);
  for (const [id, c] of authored) if (!gen.commands.some((g) => g.id === id)) commands.push(c);
  return normalizeVoiceCommands({ ...gen, forFramework: gen.forFramework || ex.forFramework, wake: ex.wake?.length ? ex.wake : gen.wake, source: authored.size ? (authored.size === commands.length ? 'authored' : 'mixed') : 'generated', commands });
}

/** Coverage of a surface: every surface command has a voice command with phrases (the CI rule for forFramework apps). */
export function voiceCoverage(asset, surface) {
  const a = normalizeVoiceCommands(asset);
  const ids = uniq((Array.isArray(surface?.commands) ? surface.commands : []).map((e) => str(e?.id, 64).toLowerCase()).filter(Boolean));
  const have = new Map(a.commands.map((c) => [c.id, c]));
  const missing = ids.filter((id) => !have.get(id)?.phrases.length);
  const extra = a.commands.filter((c) => c.source === 'generated' && !ids.includes(c.id)).map((c) => c.id);
  return { total: ids.length, covered: ids.length - missing.length, missing, extra, ok: missing.length === 0 };
}

/* ================================================================== JSON Schema */

export function voiceCommandSchemaProperties() {
  const slot = { type: 'object', required: ['type'], properties: { type: { enum: VOICE_SLOT_TYPES }, required: { type: 'boolean' }, options: { type: 'array', items: { type: 'string' }, maxItems: VOICE_LIMITS.options }, say: { type: 'string' }, default: {} } };
  return {
    app: { type: 'string', pattern: SLUG.source, description: 'the app (its project manifest name)' },
    forFramework: { type: 'boolean', description: 'copied from the project manifest: is this app for the framework\'s own development?' },
    source: { enum: VOICE_SOURCES },
    generatedFrom: { type: 'array', items: { enum: VOICE_TRANSPORTS } },
    wake: { type: 'array', maxItems: VOICE_LIMITS.wake, items: { type: 'string' }, description: 'names a phrase may start with ("expenses, add …") or end with ("… in expenses")' },
    commands: { type: 'array', maxItems: VOICE_LIMITS.commands, items: { type: 'object', required: ['id', 'title', 'effect', 'run', 'phrases'], properties: {
      id: { type: 'string', pattern: COMMAND_ID.source }, title: { type: 'string', maxLength: VOICE_LIMITS.title }, effect: { enum: VOICE_EFFECTS }, confirm: { enum: VOICE_CONFIRMS },
      run: { type: 'object', properties: Object.fromEntries(VOICE_TRANSPORTS.map((t) => [t, { type: 'string' }])), minProperties: 1 },
      slots: { type: 'object', additionalProperties: slot, maxProperties: VOICE_LIMITS.slots },
      phrases: { type: 'array', minItems: 1, maxItems: VOICE_LIMITS.phrases, items: { type: 'string', maxLength: VOICE_LIMITS.phrase } },
      say: { type: 'string', maxLength: VOICE_LIMITS.say }, help: { type: 'string', maxLength: VOICE_LIMITS.help }, source: { enum: ['generated', 'authored'] },
    } } },
  };
}

/* ================================================================== the bridge between a host (Molly) and an app's console frame */

/** Messages between Molly (or any host / listener) and the console's voice-commands plugin, over postMessage. */
export const VOICE_BRIDGE_FRAME = 'voice-bridge@1';
/** say: run what was said · answer: reply to a confirm / missing-slot question · help: what can I say · ping/pong: is the bridge there · utterance: a listener heard something (the host decides) · result: the answer to any of them. */
export const VOICE_BRIDGE_TYPES = ['say', 'answer', 'help', 'ping', 'pong', 'utterance', 'result'];
export function voiceBridgeMessage(type, fields = {}) { return { $axf: VOICE_BRIDGE_FRAME, type, id: fields.id ?? `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ...fields }; }
/** The message, or null when it is not one of ours. */
export function parseVoiceBridge(data) {
  if (!isObj(data) || data.$axf !== VOICE_BRIDGE_FRAME || !VOICE_BRIDGE_TYPES.includes(data.type)) return null;
  return { ...data, id: str(data.id, 80), text: str(data.text, 2000), app: str(data.app, 63) };
}
/** "what can I say (in <app>)?" asked in words: the app named, '' for every app, null when it is not that question. */
export function helpQuestion(text) {
  const m = /^(?:hey\s+)?(?:molly[,\s]+)?(?:what|which)\s+(?:can|could|do)\s+i\s+(?:say|ask|tell)(?:\s+(?:in|to|for|about)\s+([a-z][a-z0-9 -]{0,30}?))?\s*\??$/i.exec(str(text, 300).trim());
  return m ? (m[1] ?? '').trim().toLowerCase() : null;
}

/**
 * An answer to "What is <slot>?": the value parsed for that slot (typed slots through parseSlotValue, text as said,
 * fillers trimmed), then what is still missing and whether the command must still be confirmed. Pure.
 */
export function fillSlot(command, slots, name, text, now = '2026-01-01T00:00:00.000Z') {
  const c = normalizeVoiceCommands({ app: 'x', commands: [command] }).commands[0];
  const got = { ...(isObj(slots) ? slots : {}) };
  const slot = c.slots[name];
  let ws = words(text);
  while (ws.length && VOICE_FILLERS.includes(ws[0])) ws = ws.slice(1);
  let value;
  if (slot && slot.type !== 'text') { const v = parseSlotValue(slot, ws, now); if (v) value = v.value; }
  else if (ws.length) value = ws.join(' ');
  const ok = value !== undefined;
  if (ok) got[name] = value;
  const missing = Object.entries(c.slots).filter(([n, s]) => s.required && got[n] === undefined).map(([n]) => n);
  const rule = confirmRule(c);
  const confirm = rule === 'always' || (rule === 'missing' && missing.length > 0);
  const question = !ok ? `I did not get ${slot?.say || name}. ${slot?.type === 'money' ? 'How much, in dollars?' : slot?.type === 'date' ? 'Which day (today, yesterday, a date)?' : slot?.type === 'choice' ? `One of: ${(slot.options ?? []).join(', ')}.` : `What is ${slot?.say || name}?`}`
    : missing.length ? `What is ${c.slots[missing[0]].say || missing[0]}?` : rule === 'always' ? `${c.title} (${Object.entries(got).map(([k, v]) => `${k}: ${v}`).join(', ')}). Yes or no?` : '';
  return { ok, slots: got, missing: ok ? missing : [name, ...missing.filter((m) => m !== name)], confirm: !ok || confirm, question };
}
