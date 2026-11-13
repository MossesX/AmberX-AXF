/**
 * The Skins deep links. console_open {kind: screen, target: skin-gallery, focus: <path>} runs the action
 * skin-gallery.focus:<path>; the hash form #/skin-gallery?skin=&scope=&view= reads the same way.
 *   skins (no path)            the gallery
 *   skin/<id>                  one skin picked (previewed)
 *   scope/<scope>              the scope picker on hub | app | app:<id> | ui:<view> | plugin:<id>
 *   preview/<id>?view=phone    one skin previewed at phone width
 */
export interface SkinLink { skin: string; scope: string; view: '' | 'desktop' | 'phone'; seq: number }

let cur: SkinLink = { skin: '', scope: '', view: '', seq: 0 };
const subs = new Set<() => void>();

export function parseLink(raw: string): Omit<SkinLink, 'seq'> {
  const [path = '', query = ''] = decodeURIComponent(raw).replace(/^\/+/, '').split('?');
  const q = new URLSearchParams(query);
  const [head = '', ...rest] = path.split('/');
  const tail = rest.join('/');
  const view = q.get('view') === 'phone' ? 'phone' as const : q.get('view') === 'desktop' ? 'desktop' as const : '' as const;
  if (head === 'skin' || head === 'preview') return { skin: tail, scope: q.get('scope') ?? '', view: head === 'preview' && !view ? 'desktop' : view };
  if (head === 'scope') return { skin: q.get('skin') ?? '', scope: tail, view };
  return { skin: q.get('skin') ?? '', scope: q.get('scope') ?? '', view };
}

/** The link the page was opened with (hash query), read once. */
export const linkFromHash = () => parseLink(`?${location.hash.split('?')[1] ?? ''}`);

export function setLink(raw: string): void { cur = { ...parseLink(raw), seq: cur.seq + 1 }; for (const f of subs) f(); }
export const getLink = () => cur;
export function subscribeLink(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }
