/* A tiny, safe Markdown subset for AI summaries: headings, bullets, **bold**, `code`. No HTML is ever injected. */
import type { ReactNode } from 'react';

function inline(t: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push(t.slice(last, m.index));
    const x = m[0];
    out.push(x.startsWith('**') ? <strong key={m.index}>{x.slice(2, -2)}</strong> : <code key={m.index} className="fx-mono">{x.slice(1, -1)}</code>);
    last = m.index + x.length;
  }
  if (last < t.length) out.push(t.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`l${blocks.length}`} className="axp-systems-check-md__list">{list}</ul>); list = []; } };
  text.split('\n').forEach((raw, i) => {
    const l = raw.trimEnd();
    const h = /^#{1,4}\s+(.*)$/.exec(l);
    const b = /^\s*[-*•]\s+(.*)$/.exec(l);
    if (h) { flush(); blocks.push(<h4 key={i} className="axp-systems-check-md__h">{inline(h[1] ?? '')}</h4>); }
    else if (b) list.push(<li key={i}>{inline(b[1] ?? '')}</li>);
    else if (l.trim()) { flush(); blocks.push(<p key={i} className="axp-systems-check-md__p">{inline(l)}</p>); }
    else flush();
  });
  flush();
  return <div className="axp-systems-check-md">{blocks}</div>;
}
