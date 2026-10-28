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

/** A clip as the fields of a notes item. */
export function clipToItem(c: { url: string; title?: string; text?: string; tags?: string[] }) {
  const host = hostOf(c.url);
  const title = (c.title ?? '').trim() || host || 'Web page';
  const text = [c.text?.trim(), c.url].filter(Boolean).join('\n\n');
  return { kind: 'note' as const, title: title.slice(0, 160), text, url: c.url, source: 'web' as const, tags: ['web', ...(c.tags ?? [])] };
}
