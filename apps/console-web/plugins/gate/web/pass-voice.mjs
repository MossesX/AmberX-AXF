/**
 * pass-voice@1: a spoken pass command → the axHub pass call (build approval-pass-covers-every-call, s9).
 *
 * Pure, no DOM and no network. One phrase becomes one intent, `{ tool, arguments, needsId? }`, which is exactly the MCP
 * call (`axhub.pass_grant | pass_update | pass_revoke | pass_status`); `passVoiceRest` and `passVoiceCli` give the same
 * intent as the hub's REST request and its CLI words, so every driver sends the same thing (axHub docs/veto-pass.md §5a,
 * framework/spec/AXHUB-PASS.md). The console runs an intent through the hub relay (hubPassActions.ts); AmberX and any
 * other assistant send the MCP call as it stands.
 *
 *   "give me a pass for 30 minutes" · "pass for an hour" · "a 24 hour pass"        → pass_grant {covers: "all"}
 *   "pass for everything including deletes for 2 hours"                             → … include_irreversible
 *   "pass for vps and the console for an hour" · "pass for vps run for 30 minutes"  → pass_grant {covers: [...]}
 *   "make the pass cover everything" · "the pass covers vps and github"             → pass_update {covers}
 *   "make the pass quiet" · "make the pass silent"                                  → pass_update {quiet_notice}
 *   "end the pass" · "revoke my pass" · "turn the pass off"                         → pass_revoke
 *   "pass status" · "what does the pass cover" · "is a pass on"                     → pass_status
 *
 * `needsId`: the call is about the pass that is on; the caller fills `id` (the active pass ending last).
 * Fixture: framework/spec/fixtures/pass-voice.json (checked by plugins/gate/test/test.pass-voice.mjs).
 */
export const PASS_VOICE_FRAME = 'pass-voice@1';

const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12, fifteen: 15, twenty: 20, 'twenty four': 24, thirty: 30, forty: 40, 'forty five': 45, sixty: 60, ninety: 90 };
const NUMBER_WORDS = Object.keys(NUMBERS).sort((a, b) => b.length - a.length).join('|');
const DURATION = new RegExp(`\\b(\\d{1,4}|${NUMBER_WORDS})[ -]?(minutes?|mins?|hours?|hrs?|days?)\\b`);
/** The longest pass a phrase may ask for (a day); the hub's own limit decides in the end. */
export const VOICE_MAX_MINUTES = 1440;

/** Words people say for a service, a tool or a scope → the `covers` entry. */
const ALIASES = {
  console: 'axf-console', 'axf console': 'axf-console', server: 'vps', shell: 'vps', 'vps commands': 'vps.run', 'server commands': 'vps.run', 'shell commands': 'vps.run',
  theme: 'scope:tokens.theme', 'theme changes': 'scope:tokens.theme', tokens: 'scope:tokens.*', 'token changes': 'scope:tokens.*',
  stops: 'axf-console.console_terminal_sessions_stop', 'session stops': 'axf-console.console_terminal_sessions_stop', 'terminal stops': 'axf-console.console_terminal_sessions_stop',
};
const ALL = /^(everything|anything|every tool|all tools|all the tools|every call|all calls|all)$/;
const SERVICE = /^[a-z][a-z0-9-]{0,31}$/;
const TOOL = /^[a-z0-9_*][a-z0-9_.*/-]{0,127}$/;

/** Lower case, no punctuation, no wake word, no politeness, single spaces. */
export function cleanPassPhrase(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[“”"’'!?;]+/g, ' ')
    .replace(/\.+(?=[\s,]|$)/g, ' ')
    .replace(/^\s*(hey |ok |okay )?(amber|amberx)\b[\s,]*/, ' ')
    .replace(/\b(please|can you|could you|would you|for me|right now|now)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "30 minutes" · "an hour" · "2 hours" · "half an hour" · "a day" → whole minutes, or null. */
export function voiceMinutes(text) {
  const t = String(text ?? '');
  if (/\bhalf an hour\b/.test(t)) return 30;
  const m = DURATION.exec(t);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]];
  const minutes = /^d/.test(m[2]) ? n * 1440 : /^h/.test(m[2]) ? n * 60 : n;
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= VOICE_MAX_MINUTES ? minutes : null;
}

/** "everything" → "all"; "vps and the console" → ["vps", "axf-console"]; "vps run" → ["vps.run"]; unreadable → null. */
export function voiceCovers(words) {
  const t = String(words ?? '').replace(/\b(the|only|just|my|tools?|calls?|service|services|on)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (ALL.test(t) || ALL.test(String(words ?? '').trim())) return 'all';
  const out = [];
  for (const raw of t.split(/\s*(?:,|\band\b|\bplus\b)\s*/).filter(Boolean)) {
    const term = raw.trim();
    let entry = ALIASES[term] ?? '';
    if (!entry) {
      const parts = term.replace(/\s+dot\s+/g, '.').split(' ');
      const service = ALIASES[parts[0]] && SERVICE.test(ALIASES[parts[0]]) ? ALIASES[parts[0]] : parts[0];
      if (parts.length === 1 && /^[a-z][a-z0-9-]{0,31}\.[a-z0-9_*][a-z0-9_.*/-]*$/.test(term)) entry = term;
      else if (parts.length === 1 && SERVICE.test(service)) entry = service;
      else if (parts.length === 2 && SERVICE.test(service) && TOOL.test(parts[1])) entry = `${service}.${parts[1]}`;
    }
    if (!entry) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  return out.length ? out : null;
}

/** One phrase → one pass call, or null when it is not a pass command. */
export function passVoiceIntent(text) {
  const p = cleanPassPhrase(text);
  if (!/\bpass(es)?\b/.test(p)) return null;
  let m;
  if (/\b(end|revoke|stop|cancel|kill|drop)\b.*\bpass(es)?\b/.test(p) || /\b(turn|switch) (?:the |my )?pass(es)? off\b/.test(p) || /\b(turn|switch) off (?:the |my )?pass(es)?\b/.test(p)) {
    return { tool: 'axhub.pass_revoke', arguments: {}, needsId: true };
  }
  if (/\bpass(es)? status\b|\bstatus of (?:the |my )?pass(es)?\b|\bwhat does (?:the |my )?pass cover\b|\bwhat is (?:the |my )?pass covering\b|\bwhich pass(es)? (?:is|are) (?:on|active)\b|\bis (?:a|the|my|there a) pass (?:on|active)\b|\bhow long (?:is|has) (?:the |my )?pass\b/.test(p)) {
    return { tool: 'axhub.pass_status', arguments: {} };
  }
  if ((m = /\b(?:make|set|turn) (?:the |my )?pass (quiet|silent)\b/.exec(p))) {
    return { tool: 'axhub.pass_update', arguments: { quiet_notice: m[1] === 'quiet' }, needsId: true };
  }
  if ((m = /\b(?:make|have|let|set|change) (?:the |my )?pass (?:to )?cover (.+)$/.exec(p) ?? /\bpass (?:should |now |only )?covers? (.+)$/.exec(p))) {
    const covers = voiceCovers(m[1]);
    return covers ? { tool: 'axhub.pass_update', arguments: { covers }, needsId: true } : null;
  }
  const minutes = voiceMinutes(p);
  if (minutes === null) return null;
  const include = /\bincluding (?:the )?(?:deletes|irreversible(?: calls)?)\b/.test(p);
  const what = /\bpass for (.+?) for\b/.exec(p.replace(/\bincluding (?:the )?(?:deletes|irreversible(?: calls)?)\b/, ' ').replace(/\s+/g, ' '))?.[1] ?? '';
  const covers = what ? voiceCovers(what) : 'all';
  if (covers === null || (include && covers !== 'all')) return null;
  return {
    tool: 'axhub.pass_grant',
    arguments: { covers, minutes, ...(include ? { include_irreversible: true } : {}), reason: { title: `Pass for ${minutes} minutes (voice)`, description: `Said: "${String(text ?? '').trim().slice(0, 200)}"` } },
  };
}

/** `covers` as the CLI and a console action take it: `all`, or the short entries comma separated. */
export function coversText(covers) {
  if (covers === 'all') return 'all';
  return (Array.isArray(covers) ? covers : [covers])
    .map((e) => (typeof e === 'string' ? e : e.service === '*' && !e.tool ? `scope:${e.scope ?? ''}` : `${e.service}${e.tool ? `.${e.tool}` : ''}${e.scope ? `@${e.scope}` : ''}`))
    .join(',');
}

const PASS_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/;
const idOf = (intent, id) => String(intent?.arguments?.id ?? id ?? '');

/** The same intent as the hub's REST request (admin session; the console sends it through its hub relay). Null without the id it needs. */
export function passVoiceRest(intent, id = '') {
  const a = intent?.arguments ?? {};
  const pass = idOf(intent, id);
  const { id: _id, ...rest } = a;
  switch (intent?.tool) {
    case 'axhub.pass_grant':
      return { method: 'POST', path: '/auth/api/passes', body: rest };
    case 'axhub.pass_status':
      return { method: 'GET', path: pass && PASS_ID.test(pass) ? `/auth/api/passes/${encodeURIComponent(pass)}` : '/auth/api/passes' };
    case 'axhub.pass_update':
      return PASS_ID.test(pass) ? { method: 'POST', path: `/auth/api/passes/${encodeURIComponent(pass)}/update`, body: rest } : null;
    case 'axhub.pass_revoke':
      return PASS_ID.test(pass) ? { method: 'POST', path: `/auth/api/passes/${encodeURIComponent(pass)}/revoke`, body: {} } : null;
    default:
      return null;
  }
}

/** The same intent as the hub's CLI words (`axhub <words>`). Null without the id it needs. */
export function passVoiceCli(intent, id = '') {
  const a = intent?.arguments ?? {};
  const pass = idOf(intent, id);
  switch (intent?.tool) {
    case 'axhub.pass_grant': {
      const title = typeof a.reason === 'string' ? a.reason : a.reason?.title;
      return ['passes', 'grant', String(a.minutes), '--covers', coversText(a.covers ?? 'all'), ...(a.include_irreversible ? ['--include-irreversible'] : []), ...(title ? ['--reason', title] : [])];
    }
    case 'axhub.pass_status':
      return pass ? ['passes', 'show', pass] : ['passes', 'list'];
    case 'axhub.pass_update':
      return pass ? ['passes', 'update', pass, ...(a.covers !== undefined ? ['--covers', coversText(a.covers)] : []), ...(a.include_irreversible ? ['--include-irreversible'] : []), ...(a.quiet_notice !== undefined ? ['--quiet-notice', a.quiet_notice ? 'on' : 'off'] : [])] : null;
    case 'axhub.pass_revoke':
      return pass ? ['passes', 'revoke', pass] : null;
    default:
      return null;
  }
}

const mins = (seconds) => { const m = Math.max(1, Math.round(Number(seconds) / 60)); return m >= 120 ? `${Math.round(m / 60)} hours` : `${m} minute${m === 1 ? '' : 's'}`; };
const label = (p) => String(p?.scopeLabel ?? p?.label ?? (p?.covers === 'all' ? 'everything' : 'what it names'));

/** What to say back, from the hub's answer (`{pass}` for a change, `{active: [...]}` for the list, `{error}` when it refused). */
export function passVoiceReply(intent, answer) {
  const a = answer ?? {};
  if (a.error) return String(a.error.message ?? a.error);
  const p = a.pass;
  switch (intent?.tool) {
    case 'axhub.pass_grant':
      return p ? `Pass on: ${label(p)} for ${mins(p.secondsLeft)}.` : 'The pass is on.';
    case 'axhub.pass_update':
      return p ? `The pass now covers ${label(p)}${p.quietNotice ? ', with a quiet line for each run' : ''}.` : 'The pass is changed.';
    case 'axhub.pass_revoke':
      return 'The pass has ended.';
    case 'axhub.pass_status': {
      const list = p ? [p] : Array.isArray(a.active) ? a.active : Array.isArray(a.passes) ? a.passes : [];
      const on = list.filter((x) => x.active !== false && Number(x.secondsLeft) > 0);
      const calls = (x) => { const n = Number(x.runs ?? x.uses ?? 0); return `${n} call${n === 1 ? '' : 's'} ran under it`; };
      if (!on.length) return p ? `That pass has ended. ${calls(p)}.` : 'No pass is on.';
      return on.map((x) => `A pass covers ${label(x)} for ${mins(x.secondsLeft)} more; ${calls(x)}.`).join(' ');
    }
    default:
      return "That isn't a pass command I know.";
  }
}

/** The pass a `needsId` intent is about: the active stored one ending last (the hub names the same one in its log). */
export function activePassId(passes) {
  const on = (Array.isArray(passes) ? passes : []).filter((p) => p && p.active !== false && Number(p.secondsLeft) > 0 && p.grantedVia !== 'feed');
  on.sort((a, b) => String(b.expiresAt ?? '').localeCompare(String(a.expiresAt ?? '')));
  return on[0]?.id ?? '';
}
