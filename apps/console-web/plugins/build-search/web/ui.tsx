/**
 * Build search UI: the search page (box, type filters, every hit grouped per document with its instances numbered,
 * icon by type), the log viewer (the document scrolled to the hit, the line highlighted, previous / next instance,
 * hit actions) and the settings panel (AI switch, sources, actions, limits). Framework controls and tokens only.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Container, Icon, IconButton, Note, Switch, TextField, useRuntime } from '@console/axf/react';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import {
  FOLDER, addAction, addSource, closeLog, fillRun, getState, hitLink, hitPlace, loadSettings, loadSources, openHit, removeAction,
  removeSource, runQuery, setAi, setBuild, setSetting, setTypes, useBuildSearch, type Group, type Hit, type HitAction,
} from './store';
import { TYPES, typeIcon, typeLabel } from '../engine.mjs';

const TYPE_IDS = Object.keys(TYPES);

/** A line with its matches marked. */
export function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, a)}</Fragment>);
    parts.push(<mark key={`m${i}`} className="axp-build-search__mark">{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

/** Ranges of the query's plain words in a line (the log viewer marks them on every line). */
function rangesIn(line: string, q: string): [number, number][] {
  const words = (q.match(/"[^"]+"|\S+/g) ?? []).filter((w) => !/^-|^(type|in|build|b):|^\//i.test(w)).map((w) => w.replace(/^"|"$/g, '')).filter(Boolean);
  const out: [number, number][] = [];
  const low = line.toLowerCase();
  for (const w of words) { let i = 0; const lw = w.toLowerCase(); while ((i = low.indexOf(lw, i)) >= 0) { out.push([i, i + lw.length]); i += lw.length; } }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([r[0], r[1]]); }
  return merged;
}

function copy(rt: ReturnType<typeof useRuntime>, text: string, what: string) {
  void globalThis.navigator?.clipboard?.writeText(text).then(() => rt.toast(`${what} copied.`, 'info'), () => rt.toast(text, 'info', `Copy this ${what.toLowerCase()}`));
}

/** Run one hit action (built-in or the user's). */
export function runHitAction(rt: ReturnType<typeof useRuntime>, a: HitAction, ctx: { id: string; doc: string; type: string; build: string; line: number; n: number; text: string; path: string }) {
  switch (a.id) {
    case 'open': void openHit(ctx.id); return;
    case 'copy-link': copy(rt, hitLink(ctx.id), 'Link'); return;
    case 'copy-text': copy(rt, ctx.text, 'Line'); return;
    case 'open-build': void openHit(`build:${ctx.build}`); return;
    case 'filter-build': setBuild(ctx.build); return;
    default: {
      if (!a.run) return;
      const spec = fillRun(a.run, { ...ctx, q: getState().q });
      if (/^https:\/\//i.test(spec)) globalThis.open?.(spec, '_blank', 'noopener');
      else if (!rt.dispatch(spec)) rt.toast(`Action ${a.label} did nothing (${spec}).`, 'warning');
    }
  }
}

/* ================================================================== results */

function HitRow({ g, h, active, onPick }: { g: Group; h: Hit; active: boolean; onPick: () => void }) {
  return (
    <div role="option" aria-selected={active} tabIndex={-1} data-fx-row data-hit={h.id}
      className={`axp-build-search__hit ${active ? 'is-active' : ''}`} onClick={onPick} title={`Open ${g.title} at line ${h.line}`}>
      <span className="axp-build-search__inst">Instance {h.n} · line {h.line}</span>
      <span className="axp-build-search__snip"><Marked text={h.text} ranges={h.ranges} /></span>
    </div>
  );
}

function Results({ onPick }: { onPick: (id: string) => void }) {
  const s = useBuildSearch();
  const r = s.result;
  const flat = useMemo(() => (r?.groups ?? []).flatMap((g) => g.hits.map((h) => ({ g, h }))), [r]);
  const [fold, setFold] = useState<Record<string, boolean>>({});
  if (!r) return null;
  if (!r.total) return <Note>No hits for “{r.q}” in {r.searched} document(s).{r.error ? ` ${r.error}` : ''}</Note>;
  return (
    <div className="axp-build-search__results" role="listbox" aria-label="Search hits">
      <p className="axp-build-search__summary">{r.total} hit(s) in {r.docs} document(s){r.truncated ? ` · first ${r.shown} shown (narrow the search or raise the limits)` : ''}{r.ms != null ? ` · ${r.ms} ms` : ''}</p>
      {r.groups.map((g) => {
        const closed = fold[g.doc];
        return (
          <div key={g.doc} className="axp-build-search__group">
            <div className="axp-build-search__ghead" data-fx-row role="button" tabIndex={0} aria-expanded={!closed}
              onClick={() => setFold((f) => ({ ...f, [g.doc]: !closed }))} onKeyDown={(e) => { if (e.key === 'Enter') setFold((f) => ({ ...f, [g.doc]: !closed })); }}>
              <Icon name={closed ? 'chevron-right' : 'chevron-down'} size={14} />
              <span className="axp-build-search__type" title={g.typeLabel}><Icon name={g.icon} size={16} /></span>
              <span className="axp-build-search__gtitle">{g.title}</span>
              <span className="axp-build-search__count">{g.count === 1 ? '1 instance' : `${g.count} instances`}</span>
            </div>
            {!closed && g.hits.map((h) => <HitRow key={h.id} g={g} h={h} active={s.openedHit === h.id} onPick={() => onPick(h.id)} />)}
            {!closed && g.count > g.hits.length && <p className="axp-build-search__more">{g.count - g.hits.length} more in this document (open it to see them all)</p>}
          </div>
        );
      })}
      {flat.length === 0 && <Note>No hits shown.</Note>}
    </div>
  );
}

/* ================================================================== log viewer */

export function LogViewer() {
  const rt = useRuntime();
  const s = useBuildSearch();
  const o = s.opened;
  const box = useRef<HTMLDivElement>(null);
  const place = s.openedHit ? hitPlace(s.openedHit) : null;
  const placeN = place?.group.hits[place.index]?.n ?? 0;
  useEffect(() => {
    if (!o) return;
    const el = box.current?.querySelector<HTMLElement>('.axp-build-search__logline.is-current');
    el?.scrollIntoView({ block: 'center' });
  }, [o, s.openedHit]);
  if (s.openBusy && !o) return <Note>Opening…</Note>;
  if (!o) return <Note>Pick a hit to open its log at that spot.</Note>;
  const step = (d: number) => {
    if (!place) return;
    const next = place.group.hits[place.index + d];
    if (next) void openHit(next.id);
  };
  const cur = o.lines[o.line - o.start] ?? '';
  const ctx = { id: s.openedHit || `${o.doc.id}#${o.line}`, doc: o.doc.id, type: o.doc.type, build: o.doc.build, line: o.line, n: placeN, text: cur, path: o.doc.path };
  return (
    <Container title={o.doc.title} icon={typeIcon(o.doc.type)} className="axp-build-search__log"
      actions={<IconButton icon="x" label="Close the log" onClick={closeLog} />}>
      <div className="axp-build-search__logbar" role="toolbar" aria-label="Log viewer">
        <span className="axp-build-search__where">{typeLabel(o.doc.type)} · line {o.line} of {o.total}{place ? ` · instance ${placeN} of ${place.group.count}` : ''}</span>
        <Button size="sm" icon="chevron-up" disabled={!place || place.index === 0} onClick={() => step(-1)}>Previous</Button>
        <Button size="sm" icon="chevron-down" disabled={!place || place.index >= place.group.hits.length - 1} onClick={() => step(1)}>Next</Button>
        {o.actions.filter((a) => a.id !== 'open').map((a) => (
          <Button key={a.id} size="sm" tone="quiet" icon={a.icon} onClick={() => runHitAction(rt, a, ctx)}>{a.label}</Button>
        ))}
      </div>
      <div ref={box} className="axp-build-search__logbody" role="log" aria-label={o.doc.title}>
        {o.start > 1 && <p className="axp-build-search__more">{o.start - 1} earlier line(s)</p>}
        {o.lines.map((l, i) => {
          const n = o.start + i;
          const curLine = n === o.line;
          return (
            <div key={n} className={`axp-build-search__logline ${curLine ? 'is-current' : ''}`} aria-current={curLine ? 'true' : undefined}>
              <span className="axp-build-search__lineno">{n}</span>
              <span className="axp-build-search__logtext"><Marked text={l} ranges={rangesIn(l, s.q)} /></span>
            </div>
          );
        })}
        {o.end < o.total && <p className="axp-build-search__more">{o.total - o.end} later line(s)</p>}
      </div>
    </Container>
  );
}

/* ================================================================== page */

export function BuildSearchView() {
  const s = useBuildSearch();
  const [q, setQ] = useState(s.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setQ(s.q); }, [s.q]);
  useEffect(() => { if (!s.settings) void loadSettings(); }, [s.settings]);
  const change = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim().startsWith('>')) timer.current = setTimeout(() => void runQuery(v), 300);
  };
  const flat = (s.result?.groups ?? []).flatMap((g) => g.hits);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') { if (timer.current) clearTimeout(timer.current); void runQuery(q); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = flat.findIndex((h) => h.id === s.openedHit);
    const next = flat[Math.min(flat.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) void openHit(next.id);
  };
  const toggle = (t: string) => setTypes(s.types.includes(t) ? s.types.filter((x) => x !== t) : [...s.types, t]);
  return (
    <div className="fx-stack fx-stack--lg axp-build-search">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Builds</p><h1>Build search</h1></div></header>
      <div className="axp-build-search__box" onKeyDown={keys}>
        <TextField label="Search builds, notes, reports and session logs" type="search" value={q} onChange={change} autoFocus
          placeholder='words, "a phrase", /regex/, -word, type:log, build:<id>  ·  >help for commands'
          hint={s.settings?.ai.enabled ? 'AI features are on (Settings → Plugins → Build search).' : 'No AI: plain text search. AI features are off.'} />
        <div className="axp-build-search__filters" role="toolbar" aria-label="Search in">
          {TYPE_IDS.map((t) => (
            <Button key={t} size="sm" tone={s.types.includes(t) ? 'primary' : 'quiet'} icon={typeIcon(t)} aria-pressed={s.types.includes(t)} onClick={() => toggle(t)}>{typeLabel(t)}</Button>
          ))}
          {s.build && <Button size="sm" tone="primary" icon="x" onClick={() => setBuild('')}>Build: {s.build}</Button>}
          <Button size="sm" icon="refresh" busy={s.busy} onClick={() => void runQuery(q)}>Search</Button>
        </div>
      </div>
      {s.error && <Note tone="danger">{s.error}</Note>}
      {s.message && <Note tone="success"><span className="axp-build-search__pre">{s.message}</span></Note>}
      <div className={`axp-build-search__split ${s.opened ? 'is-open' : ''}`}>
        <div className="axp-build-search__left"><Results onPick={(id) => void openHit(id)} /></div>
        {(s.opened || s.openBusy) && <div className="axp-build-search__right"><LogViewer /></div>}
      </div>
    </div>
  );
}

/* ================================================================== settings */

export function SettingsPanel() {
  const s = useBuildSearch();
  const rt = useRuntime();
  const [src, setSrc] = useState({ name: '', path: '', type: 'file' });
  const [act, setAct] = useState({ label: '', run: '' });
  useEffect(() => { void loadSettings(); void loadSources(); }, []);
  const st = s.settings;
  if (!st) return <Note>{s.error || 'Loading…'}</Note>;
  return (
    <div className="fx-stack fx-stack--lg">
      <Container title="AI" icon="sparkles">
        <Switch label="Allow AI features" checked={st.ai.enabled} onChange={(v) => void setAi(v)}
          hint="Off by default. Build search never calls a model on its own, even when an AI connection exists: search, hits, the log viewer, sources and actions are all plain code." />
      </Container>
      <Container title="Sources" icon="folder">
        <ul className="axp-build-search__list">
          {(s.sources?.builtIn ?? []).map((b) => <li key={b.id}><Icon name={typeIcon(b.id)} size={14} /> {b.label} <span className="axp-build-search__count">{b.count}</span></li>)}
          {st.sources.map((x) => (
            <li key={x.id}><Icon name={typeIcon(x.type)} size={14} /> {x.name} <code>{x.path}</code> <span className="axp-build-search__count">{s.sources?.user.find((u) => u.id === x.id)?.count ?? ''}</span>
              <IconButton icon="trash" label={`Remove source ${x.name}`} onClick={() => void removeSource(x.id)} /></li>
          ))}
        </ul>
        {s.sources && <p className="axp-build-search__more">Session folders read from: {s.sources.roots.join(', ') || 'none found'}</p>}
        <div className="axp-build-search__form">
          <TextField label="Name" value={src.name} onChange={(v) => setSrc({ ...src, name: v })} />
          <TextField label="File, folder or glob" mono value={src.path} onChange={(v) => setSrc({ ...src, path: v })} placeholder="docs/**/*.md" />
          <TextField label="Type" value={src.type} onChange={(v) => setSrc({ ...src, type: v })} />
          <Button icon="plus" disabled={!src.name || !src.path} onClick={() => void addSource(src.name, src.path, src.type).then((ok) => ok && setSrc({ name: '', path: '', type: 'file' }))}>Add source</Button>
        </div>
      </Container>
      <Container title="Hit actions" icon="zap">
        <ul className="axp-build-search__list">
          {st.actions.map((a) => <li key={a.id}><Icon name={a.icon} size={14} /> {a.label} <code>{a.run}</code><IconButton icon="trash" label={`Remove action ${a.label}`} onClick={() => void removeAction(a.id)} /></li>)}
          {!st.actions.length && <li>Only the built-in actions (open, copy link, copy line, open the build, only this build).</li>}
        </ul>
        <div className="axp-build-search__form">
          <TextField label="Label" value={act.label} onChange={(v) => setAct({ ...act, label: v })} />
          <TextField label="Runs" mono value={act.run} onChange={(v) => setAct({ ...act, run: v })} placeholder="nav:build-orchestrator · https://github.com/…{build}" hint="A console action, nav:<page> or an https link; {build} {line} {doc} {type} {n} {q} {text} {path} are filled in." />
          <Button icon="plus" disabled={!act.label || !act.run} onClick={() => void addAction(act.label, act.run).then((ok) => ok && setAct({ label: '', run: '' }))}>Add action</Button>
        </div>
      </Container>
      <Container title="Limits" icon="sliders">
        <div className="axp-build-search__form">
          {(['maxHits', 'maxPerDoc', 'snippet'] as const).map((k) => (
            <TextField key={k} label={{ maxHits: 'Most hits listed', maxPerDoc: 'Most instances per document', snippet: 'Characters per hit' }[k]} type="number" value={String(st[k])} onChange={(v) => void setSetting(k, Number(v))} />
          ))}
        </div>
      </Container>
      {s.error && <Note tone="danger">{s.error}</Note>}
      <Button icon="search" onClick={() => rt.navigate('build-search')}>Open Build search</Button>
    </div>
  );
}

export const LifecyclePanel = () => <PluginLifecyclePanel folder={FOLDER} />;
