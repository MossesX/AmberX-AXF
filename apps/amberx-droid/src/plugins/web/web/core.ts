/**
 * Web plugin rules, pure (tested by apps/amberx-droid/test.mjs): which addresses may open, how a typed address becomes
 * one, and what a clip looks like as a notes item.
 */
export const WEB_LIST = 'web';
export const MAX_TABS = 8;

/** A typed address → an https/http URL, or a search when it isn't one. Never javascript:, data:, file: … */
export function toUrl(typed: string, search = 'https://duckduckgo.com/?q='): string | null {
  const t = typed.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return safeUrl(t);
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !/\s/.test(t)) return safeUrl(`https://${t}`);
  return `${search}${encodeURIComponent(t)}`;
}

export function safeUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };

/* ---------------------------------------------------------------- "go to <any website>" (voice, Nov 12 2026) */

/** Spoken top-level domains a "go to" target must end with (so "go to notes" stays a page of the app). */
export const SPOKEN_TLDS = ['com', 'org', 'net', 'io', 'ai', 'dev', 'co', 'uk', 'us', 'ca', 'de', 'fr', 'au', 'nz', 'info', 'biz', 'edu', 'gov', 'xyz', 'tech', 'me', 'gg', 'tv'] as const;
/** Second-level labels that come before a country code ("bbc co uk"). */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
const TLD = new Set<string>(SPOKEN_TLDS);
/** "feeling lucky" search: a named site with no domain ("go to website wikipedia") lands on its first result. */
export const LUCKY = 'https://duckduckgo.com/?q=!ducky+';
export const MAX_GO_LOG = 100;

export interface GoTo { url: string; record: boolean; host: string; spoken: string }
/** One open, as the audit log keeps it (Web → Opened, `web.state`). */
export interface GoLogEntry { at: string; url: string; host: string; record: boolean; via: 'voice' | 'action' | 'typed'; where: 'phone' | 'tab' }

const VERB = /^(?:please )?(?:go to|goto|open up|open|browse to|browse|visit|navigate to|take me to|pull up|load|bring up)\s+(.+)$/;
const RECORD_VERB = /^(?:please )?(?:record|start recording|recording)\s+(?:on\s+)?(.+)$/;
const RECORD_TAIL = /\s+(?:and (?:start )?record(?:ing)?(?: it| that| this| the screen| audio| the audio)?|with (?:the )?recorder(?: on| running)?|with recording(?: on)?|while recording|and turn on (?:the )?recorder|recording)$/;
const SITE_WORD = /^(?:the )?(?:website|web site|site|web page|webpage|page|url|address)\s+/;

/** Spoken site words → a host (and path): "example dot com" / "example com" / "bbc co uk slash news". Null when it isn't one. */
export function spokenHost(words: string): { host: string; path: string } | null {
  const [site = '', ...pathParts] = words.split(/\s+slash\s+/);
  const path = pathParts.map((p) => p.trim().replace(/\s+/g, '-')).filter(Boolean).join('/');
  if (/\sdot\s/.test(` ${site} `)) {
    const labels = site.split(/\s*\bdot\b\s*/).map((l) => l.replace(/\s+/g, '')).filter(Boolean);
    if (labels.length < 2 || !TLD.has(labels[labels.length - 1]!)) return null;
    return { host: labels.join('.'), path };
  }
  const t = site.trim().split(/\s+/).filter(Boolean);
  if (t.length < 2 || !TLD.has(t[t.length - 1]!)) return null;
  const suffix = [t.pop()!];
  if (t.length >= 2 && SECOND_LEVEL.has(t[t.length - 1]!) && suffix[0]!.length === 2) suffix.unshift(t.pop()!);
  const name = t.join('');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  return { host: [name, ...suffix].join('.'), path };
}

/**
 * What a "go to <any website>" sentence opens, or null when it isn't one (then other commands get it). Works on what
 * the recognizer hands over, raw ("go to example.com") or normalized ("go to example com"). A target must name a
 * domain, or say "website" before a name (then a feeling-lucky search finds it). Only http(s) ever comes out.
 */
export function parseGoTo(heard: string): GoTo | null {
  const raw = String(heard ?? '').trim();
  if (!raw) return null;
  let s = raw.toLowerCase().replace(/[!?,;]+$/g, '').replace(/\s+/g, ' ').trim();
  let record = false;
  const rv = RECORD_VERB.exec(s);
  if (rv) { record = true; s = `go to ${rv[1]}`; }
  const tail = RECORD_TAIL.exec(s);
  if (tail) { record = true; s = s.slice(0, tail.index); }
  const m = VERB.exec(s);
  if (!m) return null;
  let target = m[1]!.trim();
  const named = SITE_WORD.test(target);
  target = target.replace(SITE_WORD, '').trim();
  if (!target) return null;
  // A spelled-out address or URL ("example.com/news", "https://…"): the typed-address rules.
  const literal = target.replace(/\s+/g, '');
  if (/[./]/.test(target) && !/\s/.test(target.trim())) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(literal) && !/^https?:\/\//i.test(literal)) return null;
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(literal) && !/^https?:\/\//i.test(literal)) return null; // javascript:, file:, intent: …
    const url = safeUrl(/^https?:\/\//i.test(literal) ? literal : `https://${literal}`);
    const host = url ? hostOf(url) : '';
    return url && /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host) ? { url, record, host, spoken: raw } : null;
  }
  const words = target.replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sh = spokenHost(words);
  if (sh) {
    const url = safeUrl(`https://${sh.host}/${sh.path}`);
    return url ? { url, record, host: sh.host, spoken: raw } : null;
  }
  if (named && words) return { url: `${LUCKY}${encodeURIComponent(words).replace(/%20/g, '+')}`, record, host: words, spoken: raw };
  return null;
}

/** The newest-first audit log with one more open, capped. */
export function logOpen(log: readonly GoLogEntry[], e: GoLogEntry, max = MAX_GO_LOG): GoLogEntry[] {
  return [e, ...log].slice(0, max);
}

/** A clip as the fields of a notes item. */
export function clipToItem(c: { url: string; title?: string; text?: string; tags?: string[] }) {
  const host = hostOf(c.url);
  const title = (c.title ?? '').trim() || host || 'Web page';
  const text = [c.text?.trim(), c.url].filter(Boolean).join('\n\n');
  return { kind: 'note' as const, title: title.slice(0, 160), text, url: c.url, source: 'web' as const, tags: ['web', ...(c.tags ?? [])] };
}
