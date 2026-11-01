import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, IconButton, Segmented, Slider, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import { pluginApi, pluginFetch } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as sc from './shots-core.mjs';
import type { GroupBy, Screenshot } from './shots-core.mjs';
import { FOLDER, KEYS, SHOT_PARAM } from './keys';

/*
 * UI Review → Screenshots: pictures that are not waiting for a decision (check sessions, live captures, PR before/after,
 * Brett's own uploads). A framework grid (search, filters, sortable date column) grouped by app / screen / source / day,
 * or thumbnails; tap one for the full-screen viewer (swipe, arrow keys, before/after slider when paired, copy link, send
 * to review, delete). They never join the approve / reject queue unless sent there.
 */

const api = pluginApi(FOLDER, 'UI Review', { unavailable: 'The UI Review plugin is switched off or its server part is not running.' });
const setting = <T,>(rt: ReturnType<typeof useRuntime>, k: string, d: T): T => { try { return (rt.settings.get(k) as T) ?? d; } catch { return d; } };
const save = (rt: ReturnType<typeof useRuntime>, k: string, v: unknown) => { try { rt.settings.set(k, v as Parameters<typeof rt.settings.set>[1]); } catch { /* not saved */ } };
const fmtDate = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const isPhone = () => globalThis.matchMedia?.('(max-width: 640px)').matches ?? false;

/** A screenshot through the console token (an <img src> can't send it): fetched once, kept as a blob URL. */
const blobs = new Map<string, Promise<string>>();
function fileUrl(id: string): Promise<string> {
  let p = blobs.get(id);
  if (!p) { p = pluginFetch(FOLDER, `shots/file?id=${encodeURIComponent(id)}`).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return URL.createObjectURL(await r.blob()); }); blobs.set(id, p); p.catch(() => blobs.delete(id)); }
  return p;
}
function Pic({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; setUrl(''); setFailed(false); fileUrl(id).then((u) => live && setUrl(u), () => live && setFailed(true)); return () => { live = false; }; }, [id]);
  if (failed) return <span className={`axp-ui-review__noimg ${className ?? ''}`}><Icon name="alert" size={14} /></span>;
  return url ? <img src={url} alt={alt} className={className} draggable={false} loading="lazy" /> : <span className={`axp-ui-review__noimg ${className ?? ''}`} aria-busy="true" />;
}

const readAsDataUrl = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(f); });

/** Before / after: the after picture over the before one, cut at the slider. */
function CompareSlider({ before, after }: { before: Screenshot; after: Screenshot }) {
  const [at, setAt] = useState(50);
  return (
    <div className="axp-ui-review__cmp">
      <div className="axp-ui-review__cmpstage">
        <Pic id={before.id} alt={`Before: ${before.title}`} className="axp-ui-review__cmpimg" />
        <span className="axp-ui-review__cmpafter" style={{ clipPath: `inset(0 0 0 ${at}%)` }}><Pic id={after.id} alt={`After: ${after.title}`} className="axp-ui-review__cmpimg" /></span>
        <span className="axp-ui-review__cmpline" style={{ insetInlineStart: `${at}%` }} aria-hidden="true" />
      </div>
      <div className="axp-ui-review__cmpbar"><Slider label="Before ◂ ▸ After" value={at} onChange={setAt} unit="%" /></div>
    </div>
  );
}

/** Full screen: one screenshot at a time (swipe, ← →, Esc), its facts and actions. */
function Viewer({ list, index, all, onIndex, onClose, act }: { list: Screenshot[]; index: number; all: Screenshot[]; onIndex: (i: number) => void; onClose: () => void; act: Acts }) {
  const n = list.length;
  const s = list[Math.min(index, n - 1)];
  const [compare, setCompare] = useState(true);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const go = (d: number) => onIndex((index + d + n) % n);
  useEffect(() => { box.current?.focus(); }, []);
  if (!s) return null;
  const pair = sc.pairOf(all, s);
  return (
    <div ref={box} className="axp-ui-review__viewer" role="dialog" aria-modal="true" aria-label={s.title} tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); e.preventDefault(); } if (e.key === 'ArrowRight') { go(1); e.preventDefault(); } if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); } }}>
      <div className="axp-ui-review__vbar">
        <IconButton icon="x" label="Close" onClick={onClose} />
        <span className="axp-ui-review__ptitle">{s.title}</span>
        <span className="fx-small fx-muted axp-ui-review__pcount">{index + 1} / {n}</span>
        <IconButton icon="chevron-left" label="Previous screenshot" onClick={() => go(-1)} disabled={n < 2} />
        <IconButton icon="chevron-right" label="Next screenshot" onClick={() => go(1)} disabled={n < 2} />
      </div>
      <div className={`axp-ui-review__vstage is-${s.viewport}`}
        onTouchStart={(e) => { const t = e.touches[0]; if (t) touch.current = { x: t.clientX, y: t.clientY }; }}
        onTouchEnd={(e) => { const st = touch.current; touch.current = null; if (!st || (pair && compare)) return; const t = e.changedTouches[0]; if (!t) return; const dx = t.clientX - st.x; const dy = t.clientY - st.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1); }}>
        {pair && compare ? <CompareSlider before={pair.before} after={pair.after} /> : <Pic id={s.id} alt={s.title} className="axp-ui-review__img" />}
      </div>
      <div className="axp-ui-review__vfoot">
        <span className="fx-small fx-muted axp-ui-review__vmeta">
          {[sc.sourceInfo(s.source).label, s.app, s.screen, s.viewport === 'phone' ? 'Phone' : 'Desktop', fmtDate(s.takenAt), s.session && `session ${s.session}`, s.pair && `${s.side} · ${s.pair}`, s.promoted.length ? 'sent to review' : ''].filter(Boolean).join(' · ')}
        </span>
        {s.note && <p className="axp-ui-review__notes fx-small">{s.note}</p>}
        <div className="axp-ui-review__acts">
          {pair && <Button size="sm" tone={compare ? 'primary' : 'neutral'} icon="sliders" aria-pressed={compare} onClick={() => setCompare(!compare)}>Before / after</Button>}
          <Button size="sm" icon="copy" onClick={() => void act.copy(s)}>Copy link</Button>
          <Button size="sm" icon="eye" onClick={() => void act.promote([s])}>Send to review</Button>
          <Button size="sm" tone="danger" icon="trash" confirm={`Delete "${s.title}"? This can't be undone.`} onClick={() => void act.remove([s])}>Delete</Button>
        </div>
      </div>
    </div>
  );
}

interface Acts { copy: (s: Screenshot) => Promise<void>; promote: (xs: Screenshot[]) => Promise<void>; remove: (xs: Screenshot[]) => Promise<void> }
type Mode = 'grid' | 'thumbs';

export function ScreenshotsTab({ onCount }: { onCount?: (n: number) => void }) {
  const rt = useRuntime();
  const [shots, setShots] = useState<Screenshot[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [app, setApp] = useState('');
  const [source, setSource] = useState('');
  const [viewport, setViewport] = useState('');
  const [by, setByRaw] = useState<GroupBy>(() => setting(rt, KEYS.shotGroup, 'app') as GroupBy);
  const [mode, setModeRaw] = useState<Mode>(() => setting(rt, KEYS.shotMode, 'grid') as Mode);
  const [sort, setSort] = useState<GridSort>({ col: 'date', dir: -1 });
  const [hidden, setHidden] = useState<string[]>(() => (isPhone() ? ['screen', 'source', 'viewport'] : []));
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [viewing, setViewing] = useState<{ ids: string[]; i: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const setBy = (v: GroupBy) => { setByRaw(v); save(rt, KEYS.shotGroup, v); };
  const setMode = (v: Mode) => { setModeRaw(v); save(rt, KEYS.shotMode, v); };

  const load = async () => {
    try { const r = await api.call<{ shots: Screenshot[] }>('shots'); setShots(r.shots.map((x) => sc.normShot(x).shot)); setError(''); }
    catch (e) { setError((e as Error).message); setShots((s) => s ?? []); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (shots) onCount?.(shots.length); }, [shots]);
  // a copied link (?ui-shot=<id>) opens that screenshot
  useEffect(() => {
    if (!shots) return;
    const want = new URLSearchParams(globalThis.location?.search ?? '').get(SHOT_PARAM);
    if (want && shots.some((x) => x.id === want)) setViewing({ ids: [want], i: 0 });
  }, [shots]);

  const all = shots ?? [];
  const rows = useMemo(() => sc.sortShots(sc.filterShots(all, { q, app, source, viewport }), 'newest'), [all, q, app, source, viewport]);
  const groups = useMemo(() => sc.groupShots(rows, by), [rows, by]);
  const apps = useMemo(() => sc.distinct(all, 'app'), [all]);

  const open = (s: Screenshot, list: Screenshot[]) => { const ids = list.map((x) => x.id); setViewing({ ids, i: Math.max(0, ids.indexOf(s.id)) }); };
  const act: Acts = {
    copy: async (s) => {
      const u = new URL(globalThis.location.href); u.hash = ''; u.search = ''; u.searchParams.set(SHOT_PARAM, s.id);
      try { await navigator.clipboard.writeText(u.toString()); rt.toast('Link copied', 'success'); } catch { rt.toast(u.toString(), 'info', 'Copy this link'); }
    },
    promote: async (xs) => {
      try {
        const r = await api.post<{ items: { id: string }[] }>('shots/promote', { ids: xs.map((x) => x.id) });
        rt.terminal.log('ui-review', `sent ${r.items.length} screenshot(s) to review`, 'ok');
        rt.toast(`Sent to review: ${r.items.length} waiting in UI Review`, 'success');
        await load();
      } catch (e) { rt.toast((e as Error).message, 'danger'); }
    },
    remove: async (xs) => {
      try {
        await api.post('shots/remove', { ids: xs.map((x) => x.id) });
        rt.toast(`Deleted ${xs.length} screenshot${xs.length === 1 ? '' : 's'}`, 'success');
        setViewing(null); await load();
      } catch (e) { rt.toast((e as Error).message, 'danger'); }
    },
  };
  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name));
    if (!list.length) { if (files?.length) rt.toast('Pick PNG, JPEG or WebP pictures', 'warning'); return; }
    setBusy(true);
    try {
      const payload = await Promise.all(list.map(async (f) => ({ name: f.name, data: await readAsDataUrl(f), takenAt: new Date(f.lastModified || Date.now()).toISOString() })));
      const r = await api.post<{ shots: Screenshot[] }>('shots', { source: 'manual', app, files: payload });
      rt.terminal.log('ui-review', `uploaded ${r.shots.length} screenshot(s)`, 'ok');
      rt.toast(`Uploaded ${r.shots.length} screenshot${r.shots.length === 1 ? '' : 's'}`, 'success');
      await load();
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  if (!shots) return <LoadingSkeleton rows={6} label="Loading screenshots" />;

  const cols: GridColumn<Screenshot>[] = [
    { id: 'title', label: 'Screenshot', width: 'minmax(calc(var(--fx-font-size) * 12), 3fr)', fixed: true, sortable: true, sortValue: (s) => s.title.toLowerCase(),
      render: (s) => <span className="axp-ui-review__srow"><Pic id={s.id} alt="" className="axp-ui-review__mini" /><span className="axp-ui-review__title"><b>{s.title}</b>{s.pair && <span className="fx-small fx-muted">{s.side} · {s.pair}</span>}</span></span> },
    { id: 'app', label: 'App', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (s) => s.app, render: (s) => <span className="fx-small">{s.app || '—'}</span> },
    { id: 'screen', label: 'Screen', width: 'calc(var(--fx-font-size) * 8)', sortable: true, sortValue: (s) => s.screen, render: (s) => <span className="fx-small fx-mono axp-ui-review__clip">{s.screen || '—'}</span> },
    { id: 'source', label: 'Source', width: 'calc(var(--fx-font-size) * 6)', sortable: true, sortValue: (s) => s.source, render: (s) => <span className="fx-small"><Icon name={sc.sourceInfo(s.source).icon} size={12} /> {sc.sourceInfo(s.source).label}</span> },
    { id: 'viewport', label: 'Device', width: 'calc(var(--fx-font-size) * 5)', sortable: true, sortValue: (s) => s.viewport, render: (s) => <span className="fx-small">{s.viewport === 'phone' ? 'Phone' : 'Desktop'}</span> },
    { id: 'date', label: 'Taken', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (s) => s.takenAt, render: (s) => <span className="fx-small" title={s.takenAt}>{fmtDate(s.takenAt)}</span> },
  ];
  const gridGroups: GridGroup<Screenshot>[] = groups.map((g) => ({ id: g.id, title: g.label, icon: by === 'source' ? sc.sourceInfo(g.id).icon : by === 'day' ? 'clock' : by === 'app' ? 'layout' : 'monitor', collapsed: collapsed.includes(g.id), rows: g.shots, groups: [], counts: <span className="fx-small fx-muted">{g.shots.length}</span> }));
  const viewList = viewing ? viewing.ids.map((id) => all.find((x) => x.id === id)).filter((x): x is Screenshot => !!x) : [];

  return (
    <div className="fx-stack axp-ui-review__shots">
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <div className="axp-ui-review__bar" role="toolbar" aria-label="Screenshots: filter and view">
        <input className="fx-input axp-ui-review__search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: title, app, screen, session, #PR…" aria-label="Search screenshots" />
        {apps.length > 0 && <select className="fx-input axp-ui-review__sel" value={app} onChange={(e) => setApp(e.target.value)} aria-label="App"><option value="">Every app</option>{apps.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
        <select className="fx-input axp-ui-review__sel" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source"><option value="">Every source</option>{sc.SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select className="fx-input axp-ui-review__sel" value={viewport} onChange={(e) => setViewport(e.target.value)} aria-label="Device"><option value="">Phone + desktop</option><option value="phone">Phone</option><option value="desktop">Desktop</option></select>
        <select className="fx-input axp-ui-review__sel" value={by} onChange={(e) => setBy(e.target.value as GroupBy)} aria-label="Group by">{sc.GROUPS.map((g) => <option key={g.id} value={g.id}>{g.id === 'none' ? g.label : `By ${g.label.toLowerCase()}`}</option>)}</select>
        <Segmented<Mode> size="sm" label="Layout" value={mode} onChange={setMode} options={[{ value: 'grid', label: 'Grid', icon: 'list' }, { value: 'thumbs', label: 'Thumbnails', icon: 'grid' }]} />
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void upload(e.target.files)} />
        <Button size="sm" tone="primary" icon="upload" busy={busy} disabled={busy} onClick={() => input.current?.click()}>Upload</Button>
        <IconButton icon="refresh" label="Reload screenshots" onClick={() => void load()} />
      </div>
      <p className="fx-small fx-muted axp-ui-review__countline">{rows.length} of {all.length} screenshot{all.length === 1 ? '' : 's'} · not waiting for approval; Send to review puts one in the queue.</p>

      {rows.length === 0 ? (
        <EmptyState icon="monitor">{all.length ? 'Nothing matches. Clear the search or the filters.' : 'No screenshots yet. Upload one, or save them from a session with axf shot <file> --title "…" --app … --source check.'}</EmptyState>
      ) : mode === 'thumbs' ? (
        <div className="fx-stack axp-ui-review__tgroups">
          {groups.map((g) => (
            <section key={g.id} className="axp-ui-review__tgroup" aria-label={g.label}>
              {by !== 'none' && <h3 className="axp-ui-review__thead fx-small">{g.label} <span className="fx-muted">{g.shots.length}</span></h3>}
              <div className="axp-ui-review__thumbs">
                {g.shots.map((s) => (
                  <button key={s.id} type="button" data-fx-row className={`axp-ui-review__tcard is-${s.viewport}`} onClick={() => open(s, g.shots)} title={s.title}>
                    <Pic id={s.id} alt="" className="axp-ui-review__big" />
                    <span className="axp-ui-review__tcap fx-small"><b>{s.title}</b><span className="fx-muted">{fmtDate(s.takenAt)}</span></span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <DataGrid<Screenshot> id="ui-review-screenshots" label="Screenshots" groups={gridGroups} columns={cols} rowId={(s) => s.id} rowLabel={(s) => s.title}
          hidden={hidden} onToggleColumn={(c) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))} onShowAll={() => setHidden([])}
          sort={sort} onSort={(c) => setSort((s) => (!c ? null : s?.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: c === 'date' ? -1 : 1 }))}
          onToggleGroup={(id) => setCollapsed((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))}
          onRowClick={(s) => open(s, rows)} rowTone={(s) => (s.promoted.length ? 'accent' : s.pair ? 'info' : 'muted')} compact />
      )}

      {viewing && viewList.length > 0 && <Viewer list={viewList} index={viewing.i} all={all} onIndex={(i) => setViewing({ ...viewing, i })} onClose={() => setViewing(null)} act={act} />}
    </div>
  );
}
