/**
 * Chat watch: the Breakroom group chat as read-only, redacted documents for AI sessions, plus the
 * "mentions of Brett" filter (who said what about the owner, when, and whether it reads negative).
 *
 * Pure (no fs): swarm.mjs mirrors the documents to the hub's shared data, the console API and the Breakroom read them.
 *   breakroom-chats@1     index: every chat, message counts, where each document is
 *   breakroom-chat@1      one chat's messages (redacted)
 *   breakroom-mentions@1  messages that mention Brett / the boss / the owner, newest first
 */
import { redact } from '../../../../../framework/core/session-schema.mjs';

/** Folder under the hub's amberx-axf `_data` (axhub.memory_read project "amberx-axf", area "data"). */
export const HUB_FOLDER = 'agent-swarm/chats';
export const GROUP_CHAT = { id: 'group', title: 'Breakroom group chat' };

/**
 * Words that point at Brett. "Boss" is also the orchestrator's chat name, so a plain "Boss" only counts in phrases
 * that mean the owner ("the boss", "boss man", "big boss"); Boss's own posts and Brett's own posts never count.
 */
export const MENTION_TERMS = [
  { id: 'brett', re: /\bbrett(?:'s)?\b/i },
  { id: 'the boss', re: /\b(?:the|big|head|top|our|ur|your) boss\b|\bboss ?man\b|\bbossman\b|\bthe big dog\b/i },
  { id: 'the owner', re: /\b(?:the|our|app|repo) owner\b|\bhead honcho\b|\bthe man upstairs\b|\bguy (?:in charge|who pays|signing)\b/i },
  { id: 'him', re: /\b(?:he|him) (?:said|wants|thinks|pays|asked|approved|denied|never|always)\b/i, weak: true },
];

/** Words that make a mention read as shit-talk rather than shop talk. */
const NEGATIVE = /\b(?:shit|trash|garbage|dumb|stupid|idiot|moron|clueless|lazy|cheap(?:skate)?|broke(?:ass)?|sucks?|hate|annoying|useless|wtf|clown|joke|pain in|micromanag\w*|can't code|no clue|worst|cheap ass|tight ?wad|bitch\w*|loser|pathetic|ridiculous|bullshit|bs\b|screw (?:him|brett)|f\*?\*?k (?:him|brett)|fuck (?:him|brett|that guy)|cut my pay|docked)\b/i;

const NOT_ABOUT = new Set(['boss', 'brett']);

/** Which mention terms a message hits (empty = not about Brett). Weak terms only count next to a strong one. */
export function mentionHits(text) {
  if (typeof text !== 'string' || !text) return [];
  const hits = MENTION_TERMS.filter((t) => t.re.test(text));
  return hits.some((t) => !t.weak) ? hits.map((t) => t.id) : [];
}
export const toneOf = (text) => (NEGATIVE.test(String(text ?? '')) ? 'negative' : 'neutral');

const nameMap = (roster) => Object.fromEntries([['boss', 'Boss'], ['brett', 'Brett'], ...(roster?.agents ?? []).map((a) => [a.id, a.name])]);

/** One message as it leaves the plugin: secrets redacted, the speaker's name attached. */
export function outMsg(m, names) {
  return { id: m.id, at: m.at, from: m.from, fromName: names[m.from] ?? m.from, kind: m.kind, text: redact(String(m.text ?? '')), ...(m.jobId ? { jobId: redact(m.jobId) } : {}) };
}

/** The mentions list: newest first, `limit` at most, optionally only the negative ones. */
export function mentions(state, roster, { limit = 200, negativeOnly = false, chat = GROUP_CHAT.id } = {}) {
  const names = nameMap(roster); const out = [];
  const msgs = Array.isArray(state?.messages) ? state.messages : [];
  for (let i = msgs.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const m = msgs[i];
    if (NOT_ABOUT.has(m.from)) continue;
    const hits = mentionHits(m.text); if (!hits.length) continue;
    const tone = toneOf(m.text); if (negativeOnly && tone !== 'negative') continue;
    out.push({ chat, ...outMsg(m, names), matched: hits, tone });
  }
  return out;
}

/** The three hub documents. `messageLimit` caps the chat document (the swarm keeps up to 2000). */
export function chatDocs(state, roster, at, { messageLimit = 2000 } = {}) {
  const names = nameMap(roster);
  const msgs = (Array.isArray(state?.messages) ? state.messages : []).slice(-messageLimit).map((m) => outMsg(m, names));
  const ment = mentions(state, roster, { limit: 500 });
  const path = (f) => `${HUB_FOLDER}/${f}`;
  const chat = { $axf: 'breakroom-chat@1', id: GROUP_CHAT.id, title: GROUP_CHAT.title, updatedAt: at, enabled: state?.chat?.enabled !== false, agents: names, messages: msgs };
  const mentionsDoc = { $axf: 'breakroom-mentions@1', updatedAt: at, terms: MENTION_TERMS.map((t) => t.id), count: ment.length, negative: ment.filter((m) => m.tone === 'negative').length, mentions: ment };
  const index = {
    $axf: 'breakroom-chats@1', updatedAt: at, readOnly: true,
    howTo: 'axhub.memory_read project "amberx-axf", area "data", path below. Read-only mirror, secrets redacted; written by the agent swarm.',
    chats: [{ id: GROUP_CHAT.id, title: GROUP_CHAT.title, path: path(`${GROUP_CHAT.id}.json`), messages: msgs.length, lastAt: msgs.at(-1)?.at ?? null }],
    mentions: { path: path('mentions.json'), count: mentionsDoc.count, negative: mentionsDoc.negative, lastAt: ment[0]?.at ?? null },
  };
  return { [`${GROUP_CHAT.id}.json`]: chat, 'mentions.json': mentionsDoc, 'index.json': index };
}
