/*
 * Dependency-free Markdown for assistant replies (ported from xGallery, extended): headings, lists (nested by indent),
 * task items, quotes, tables, rules, fenced code with a copy button, inline code, bold, italic, strike, links.
 * Builds React elements only — model output is never injected as HTML. Links open only for http(s)/mailto.
 */
import { Fragment, useState, type ReactNode } from 'react';
import { Icon } from '@console/axf/react';

export function Markdown({ text }: { text: string }) {
  return <div className="axp-ai-assistant__md">{blocks(text)}</div>;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); };
  return (
    <div className="axp-ai-assistant__code">
      <div className="axp-ai-assistant__code-head"><span className="fx-mono">{lang || 'code'}</span><button type="button" className="axp-ai-assistant__code-copy" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} />{copied ? 'Copied' : 'Copy'}</button></div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function blocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const at = (n: number): string => lines[n] ?? '';
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = at(i);
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !at(i).trim().startsWith(fence[1] ?? '```')) code.push(at(i++));
      i++;
      out.push(<CodeBlock key={key++} code={code.join('\n')} lang={fence[2] ?? ''} />);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const Tag = `h${Math.min(5, (h[1] ?? '#').length + 2)}` as 'h3' | 'h4' | 'h5';
      out.push(<Tag key={key++}>{inline(h[2] ?? '')}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(<hr key={key++} />); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(at(i + 1))) {
      const row = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(at(i))) rows.push(row(at(i++)));
      out.push(
        <div key={key++} className="axp-ai-assistant__tablewrap"><table className="fx-table"><thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>,
      );
      continue;
    }
    if (LIST.test(line)) {
      const items: { depth: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length && (LIST.test(at(i)) || (/^\s{2,}\S/.test(at(i)) && items.length))) {
        const m = LIST.exec(at(i));
        const prev = items[items.length - 1];
        if (m) items.push({ depth: Math.floor((m[1] ?? '').replace(/\t/g, '  ').length / 2), ordered: /\d/.test(m[2] ?? ''), text: m[3] ?? '' });
        else if (prev) prev.text += ' ' + at(i).trim();
        i++;
      }
      out.push(<Fragment key={key++}>{list(items, 0, 0).node}</Fragment>);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(at(i))) q.push(at(i++).replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key++}>{blocks(q.join('\n'))}</blockquote>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && at(i).trim() && !/^\s*(```|~~~|#{1,6}\s|>|\|)/.test(at(i)) && !LIST.test(at(i))) para.push(at(i++));
    if (!para.length) para.push(at(i++));
    out.push(<p key={key++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return out;
}

function list(items: { depth: number; ordered: boolean; text: string }[], start: number, depth: number): { node: ReactNode; next: number } {
  const lis: ReactNode[] = [];
  let i = start;
  const ordered = items[start]?.ordered;
  const it = (n: number) => items[n] ?? { depth: -1, ordered: false, text: '' };
  while (i < items.length && it(i).depth >= depth) {
    if (it(i).depth > depth) {
      const sub = list(items, i, it(i).depth);
      lis.push(<li key={`s${i}`} className="axp-ai-assistant__nested">{sub.node}</li>);
      i = sub.next;
      continue;
    }
    const task = /^\[( |x|X)\]\s+(.*)$/.exec(it(i).text);
    lis.push(<li key={i}>{task ? <><input type="checkbox" checked={task[1] !== ' '} readOnly aria-label="task" /> {inline(task[2] ?? '')}</> : inline(it(i).text)}</li>);
    i++;
  }
  const L = ordered ? 'ol' : 'ul';
  return { node: <L>{lis}</L>, next: i };
}

function safeHref(href: string): string | undefined {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : undefined;
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const rx = /(`+)([\s\S]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)<>]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = rx.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[2] !== undefined) out.push(<code key={k++}>{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={k++}>{inline(m[3] ?? m[4] ?? '')}</strong>);
    else if (m[5] !== undefined) out.push(<s key={k++}>{inline(m[5])}</s>);
    else if (m[6] !== undefined || m[7] !== undefined) out.push(<em key={k++}>{inline(m[6] ?? m[7] ?? '')}</em>);
    else if (m[8] !== undefined) {
      const href = safeHref(m[9] ?? '');
      out.push(href ? <a key={k++} href={href} target="_blank" rel="noopener noreferrer">{inline(m[8])}</a> : <span key={k++}>{m[8]}</span>);
    } else if (m[10] !== undefined) out.push(<a key={k++} href={m[10]} target="_blank" rel="noopener noreferrer">{m[10]}</a>);
    last = rx.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
