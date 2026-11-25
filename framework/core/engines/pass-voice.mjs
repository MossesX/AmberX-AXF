/**
 * pass-voice@1: spoken pass commands → the axHub pass tools (build approval-pass-covers-every-call, s9; axHub
 * decision 120). Pure, so AmberX, the console and the hub map a phrase the same way, and every phrase lands on the same
 * call the API, MCP and CLI make: axhub.pass_grant / pass_update / pass_revoke / pass_status.
 *
 *   "give me a pass for 30 minutes" · "pass for an hour" · "pass for everything for 2 hours"  → pass_grant {covers: all}
 *   "pass for vps and github for 30 minutes"                                                   → pass_grant {covers: [vps, github]}
 *   "make the pass cover everything" · "pass covers vps"                                       → pass_update {covers}
 *   "end the pass" · "revoke the pass" · "stop the pass"                                       → pass_revoke
 *   "what does the pass cover" · "pass status"                                                 → pass_status
 *   "… quietly"                                                                                → notify: quiet
 *
 * Intent: { tool, arguments, needsId? } (needsId: the caller fills `id` with the active pass, pass_status first) or null.
 * Fixture: framework/spec/fixtures/pass-voice.json. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
export const PASS_VOICE_FRAME = 'pass-voice@1';

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, ninety: 90 };
const ALL = /\b(everything|every tool|all tools|anything|all)\b/;

/** "30 minutes" / "an hour" / "2 hours" / "half an hour" → minutes, or null. */
export function voiceMinutes(text) {
  const t = String(text ?? '').toLowerCase();
  if (/\bhalf an hour\b/.test(t)) return 30;
  const m = /\b(\d+|an?|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)\s*(minutes?|mins?|hours?|hrs?|h)\b/.exec(t);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]];
  const v = /^h/.test(m[2]) ? n * 60 : n;
  return v >= 1 && v <= 240 ? v : null;
}

/** "vps and github" / "vps, the console" → covers entries (service namespaces; "the console" → axf-console). */
export function voiceCovers(words) {
  const t = String(words ?? '').toLowerCase().replace(/\b(the|for|only|just)\b/g, ' ');
  if (ALL.test(t)) return 'all';
  const list = t.split(/,|\band\b|\s+/).map((x) => x.trim()).filter(Boolean)
    .map((x) => (x === 'console' ? 'axf-console' : x === 'server' ? 'vps' : x))
    .filter((x) => /^[a-z][a-z0-9-]{0,62}$/.test(x) && !/^(minutes?|mins?|hours?|hrs?|an?|one|two|three|half|hour|quietly|quiet|\d+)$/.test(x));
  return list.length ? [...new Set(list)] : null;
}

/** One phrase → one pass tool call, or null when it is not a pass command. */
export function passVoiceIntent(text) {
  const t = String(text ?? '').toLowerCase().replace(/[.!?]+$/, '').trim();
  if (!/\bpass(es)?\b/.test(t)) return null;
  const notify = /\bquiet(ly)?\b/.test(t) ? { notify: 'quiet' } : {};
  if (/\b(end|revoke|stop|cancel|kill)\b.*\bpass\b/.test(t)) return { tool: 'axhub.pass_revoke', arguments: {}, needsId: true };
  if (/\b(status|what does|what's|which)\b/.test(t)) return { tool: 'axhub.pass_status', arguments: {} };
  const cover = /\bpass\s+(?:to\s+)?covers?\s+(.+)$/.exec(t) ?? /\bmake\s+the\s+pass\s+cover\s+(.+)$/.exec(t);
  if (cover) {
    const covers = voiceCovers(cover[1].replace(/\bquiet(ly)?\b/, ''));
    return covers ? { tool: 'axhub.pass_update', arguments: { covers, ...notify }, needsId: true } : null;
  }
  const minutes = voiceMinutes(t);
  if (minutes === null) return null;
  const what = /\bpass\s+for\s+(.+?)\s+for\s+/.exec(t)?.[1] ?? '';
  const covers = what ? voiceCovers(what) : 'all';
  return { tool: 'axhub.pass_grant', arguments: { covers: covers ?? 'all', minutes, reason: { title: `Pass for ${minutes} minutes (voice)`, description: `Said: "${String(text).slice(0, 200)}"` }, ...notify } };
}
