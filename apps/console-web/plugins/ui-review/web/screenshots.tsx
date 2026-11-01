import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, IconButton, Segmented, SelectField, Slider, TextField, usePortalRoot, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import { pluginApi, pluginFetch } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as sc from './shots-core.mjs';
import type { GroupBy, Screenshot } from './shots-core.mjs';
import * as gc from './groups-core.mjs';
import type { GroupRow, ShotGroupRec } from './groups-core.mjs';
import { FOLDER, KEYS, SHOT_PARAM } from './keys';

/*
 * UI Review → Screenshots: pictures that are not waiting for a decision (check sessions, live captures, PR before/after,
 * Brett's own uploads). A framework grid (search, filters, sortable date column) grouped by app / screen / source / day,
 * or thumbnails; tap one for the full-screen viewer (swipe, arrow keys, before/after slider when paired, copy link, send
 * to review, delete). They never join the approve / reject queue unless sent there.
 *
 * Groups (shot-group@1) come first: every screenshot is in one named, timestamped group (newest first, searchable by
 * name / date / app / source, cover thumbnail + count). Tap a group for its shots; rename, merge, delete it, or select
 * shots and move them to another group. Uploads here go into the open group, or a new one named before picking.
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

/** Before / after: the after picture over the before one, cut at `at` % (the slider sits in the viewer's footer). */
function CompareStage({ before, after, at }: { before: Screenshot; after: Screenshot; at: number }) {
  return (
    <div className="axp-ui-review__cmp">
      <div className="axp-ui-review__cmpstage">
        <Pic id={before.id} alt={`Before: ${before.title}`} className="axp-ui-review__cmpimg" />
        <span className="axp-ui-review__cmpafter" style={{ clipPath: `inset(0 0 0 ${at}%)` }}><Pic id={after.id} alt={`After: ${after.title}`} className="axp-ui-review__cmpimg" /></span>
        <span className="axp-ui-review__cmpline" style={{ insetInlineStart: `${at}%` }} aria-hidden="true" />
      </div>
    </div>
  );
}

/** Full screen: one screenshot at a time (swipe, ← →, Esc), its facts and actions. */
function Viewer({ list, index, all, onIndex, onClose, act }: { list: Screenshot[]; index: number; all: Screenshot[]; onIndex: (i: number) => void; onClose: () => void; act: Acts }) {
  const n = list.length;
  const s = list[Math.min(index, n - 1)];
  const [compare, setCompare] = useState(true);
  const [at, setAt] = useState(50);
  const portal = usePortalRoot();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const go = (d: number) => onIndex((index + d + n) % n);
  useEffect(() => { box.current?.focus(); }, []);
  if (!s) return null;
  const pair = sc.pairOf(all, s);
  // a portal: the page's own containers may be transformed, which would trap a fixed overlay inside them
  return createPortal(
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
        {pair && compare ? <CompareStage before={pair.before} after={pair.after} at={at} /> : <Pic id={s.id} alt={s.title} className="axp-ui-review__img" />}
      </div>
      <div className="axp-ui-review__vfoot">
        <span className="fx-small fx-muted axp-ui-review__vmeta">
          {[sc.sourceInfo(s.source).label, s.app, s.screen, s.viewport === 'phone' ? 'Phone' : 'Desktop', fmtDate(s.takenAt), s.session && `session ${s.session}`, s.pair && `${s.side} · ${s.pair}`, s.promoted.length ? 'sent to review' : ''].filter(Boolean).join(' · ')}
        </span>
        {s.note && <p className="axp-ui-review__notes fx-small">{s.note}</p>}
        {pair && compare && <div className="axp-ui-review__cmpbar"><Slider label="Before ◂ ▸ After" value={at} onChange={setAt} unit="%" /></div>}
        <div className="axp-ui-review__acts">
          {pair && <Button size="sm" tone={compare ? 'primary' : 'neutral'} icon="sliders" aria-pressed={compare} onClick={() => setCompare(!compare)}>Before / after</Button>}
          <Button size="sm" icon="copy" onClick={() => void act.copy(s)}>Copy link</Button>
          <Button size="sm" icon="eye" onClick={() => void act.promote([s])}>Send to review</Button>
          <Button size="sm" tone="danger" icon="trash" confirm={`Delete "${s.title}"? This can't be undone.`} onClick={() => void act.remove([s])}>Delete</Button>
        </div>
      </div>
    </div>,
    portal,
  );
}

interface Acts { copy: (s: Screenshot) => Promise<void>; promote: (xs: Screenshot[]) => Promise<void>; remove: (xs: Screenshot[]) => Promise<void> }
type Mode = 'grid' | 'thumbs';

/** One group's header: back, name + time + count, and its actions (rename, merge, select + move, delete). */
function GroupHead({ g, groups, picked, selecting, onBack, onSelecting, onPick, act }: {
  g: GroupRow; groups: GroupRow[]; picked: string[]; selecting: boolean; onBack: () => void; onSelecting: (v: boolean) => void; onPick: (ids: string[]) => void; act: GroupActs;
}) {
  const [tool, setTool] = useState<'' | 'rename' | 'merge'>('');
  const [name, setName] = useState(g.name);
  const [into, setInto] = useState('');
  const [moveTo, setMoveTo] = useState('');
  useEffect(() => { setName(g.name); setTool(''); setInto(''); }, [g.id]);
  const others = groups.filter((x) => x.id !== g.id).map((x) => ({ value: x.id, label: `${x.name} (${x.count})` }));
  return (
    <div className="fx-stack axp-ui-review__ghead">
      <div className="axp-ui-review__bar" role="toolbar" aria-label={`Group ${g.name}`}>
        <IconButton icon="chevron-left" label="All groups" onClick={onBack} />
        <span className="axp-ui-review__gname"><b>{g.name}</b><span className="fx-small fx-muted">{fmtDate(g.createdAt)} · {g.count} shot{g.count === 1 ? '' : 's'}{g.source ? ` · ${g.source}` : ''}</span></span>
        <Button size="sm" icon="edit" aria-pressed={tool === 'rename'} onClick={() => setTool(tool === 'rename' ? '' : 'rename')}>Rename</Button>
        <Button size="sm" icon="layers" aria-pressed={tool === 'merge'} disabled={!others.length} onClick={() => setTool(tool === 'merge' ? '' : 'merge')}>Merge</Button>
        <Button size="sm" icon="check" aria-pressed={selecting} tone={selecting ? 'primary' : 'neutral'} onClick={() => { onSelecting(!selecting); onPick([]); }}>Select</Button>
        <Button size="sm" tone="danger" icon="trash" confirm={`Delete the group "${g.name}" and its ${g.count} screenshot${g.count === 1 ? '' : 's'}? This can't be undone. (To keep them, merge it into another group instead.)`} onClick={() => void act.remove(g)}>Delete</Button>
      </div>
      {tool === 'rename' && (
        <div className="axp-ui-review__gtool">
          <TextField label="Group name" value={name} onChange={setName} autoFocus />
          <Button size="sm" tone="primary" icon="check" disabled={!name.trim() || name.trim() === g.name} onClick={() => void act.rename(g, name.trim()).then(() => setTool(''))}>Save name</Button>
        </div>
      )}
      {tool === 'merge' && (
        <div className="axp-ui-review__gtool">
          <SelectField label={`Move all ${g.count} into`} value={into} onChange={setInto} options={others} empty="Pick a group" />
          <Button size="sm" tone="primary" icon="layers" disabled={!into} onClick={() => void act.merge(g, into)}>Merge</Button>
        </div>
      )}
      {selecting && (
        <div className="axp-ui-review__gtool">
          <span className="fx-small fx-muted">{picked.length} selected · tap shots to pick</span>
          <SelectField label="Move to" value={moveTo} onChange={setMoveTo} options={[...others, { value: '+new', label: 'A new group…' }]} empty="Pick a group" />
          <Button size="sm" tone="primary" icon="arrow-right" disabled={!picked.length || !moveTo} onClick={() => void act.move(picked, moveTo).then(() => { onPick([]); setMoveTo(''); })}>Move</Button>
        </div>
      )}
    </div>
  );
}

interface GroupActs { rename: (g: GroupRow, name: string) => Promise<void>; merge: (g: GroupRow, into: string) => Promise<void>; remove: (g: GroupRow) => Promise<void>; move: (ids: string[], into: string) => Promise<void> }

export function ScreenshotsTab({ onCount }: { onCount?: (n: number) => void }) {
  const rt = useRuntime();
  const [shots, setShots] = useState<Screenshot[] | null>(null);
  const [groupRecs, setGroupRecs] = useState<ShotGroupRec[]>([]);
  const [gid, setGid] = useState<string | null>(null);
  const [gq, setGq] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
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
    try { const r = await api.call<{ shots: Screenshot[]; groups?: ShotGroupRec[] }>('shots'); setShots(r.shots.map((x) => sc.normShot(x).shot)); setGroupRecs(r.groups ?? []); setError(''); }
    catch (e) { setError((e as Error).message); setShots((s) => s ?? []); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (shots) onCount?.(shots.length); }, [shots]);
  // a copied link (?ui-shot=<id>) opens that screenshot
  useEffect(() => {
    if (!shots) return;
    const want = new URLSearchParams(globalThis.location?.search ?? '').get(SHOT_PARAM);
    const hit = want ? shots.find((x) => x.id === want) : undefined;
    if (hit) { if (hit.group) setGid(hit.group); setViewing({ ids: [hit.id], i: 0 }); }
  }, [shots]);

  const everything = shots ?? [];
  const groupRows = useMemo(() => gc.groupRows(groupRecs, everything), [groupRecs, everything]);
  const shownGroups = useMemo(() => groupRows.filter((g) => gc.matchGroup(g, gq)), [groupRows, gq]);
  const cur = gid ? groupRows.find((g) => g.id === gid) ?? null : null;
  useEffect(() => { if (gid && shots && !cur) setGid(null); }, [gid, shots, cur]);
  const all = useMemo(() => (cur ? everything.filter((x) => x.group === cur.id) : everything), [everything, cur]);
  const rows = useMemo(() => sc.sortShots(sc.filterShots(all, { q, app, source, viewport }), 'newest'), [all, q, app, source, viewport]);
  const groups = useMemo(() => sc.groupShots(rows, by), [rows, by]);
  const apps = useMemo(() => sc.distinct(all, 'app'), [all]);

  const openShot = (s: Screenshot, list: Screenshot[]) => { const ids = list.map((x) => x.id); setViewing({ ids, i: Math.max(0, ids.indexOf(s.id)) }); };
  const open = (s: Screenshot, list: Screenshot[]) => (selecting ? setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id])) : openShot(s, list));
  const openGroup = (id: string | null) => { setGid(id); setSelecting(false); setPicked([]); setQ(''); setApp(''); setSource(''); setViewport(''); };
  const gact: GroupActs = {
    rename: async (g, name) => {
      try { await api.post('shots/groups/update', { id: g.id, name }); rt.toast('Group renamed', 'success'); await load(); } catch (e) { rt.toast((e as Error).message, 'danger'); }
    },
    merge: async (g, into) => {
      try { const r = await api.post<{ moved: number }>('shots/groups/merge', { from: g.id, into }); rt.toast(`Merged: ${r.moved} screenshot${r.moved === 1 ? '' : 's'} moved`, 'success'); openGroup(into); await load(); } catch (e) { rt.toast((e as Error).message, 'danger'); }
    },
    remove: async (g) => {
      try { await api.post('shots/groups/delete', { id: g.id }); rt.toast(`Deleted the group "${g.name}"`, 'success'); openGroup(null); await load(); } catch (e) { rt.toast((e as Error).message, 'danger'); }
    },
    move: async (ids, into) => {
      try {
        const body = into === '+new' ? { ids, groupName: gc.suggestName(cur?.name.replace(/ - .*$/, '') || 'Moved', new Date().toISOString()) } : { ids, group: into };
        const r = await api.post<{ moved: number }>('shots/move', body);
        rt.toast(`Moved ${r.moved} screenshot${r.moved === 1 ? '' : 's'}`, 'success'); await load();
      } catch (e) { rt.toast((e as Error).message, 'danger'); }
    },
  };
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
      const r = await api.post<{ shots: Screenshot[]; group?: ShotGroupRec }>('shots', { source: 'manual', app, files: payload, ...(cur ? { groupId: cur.id } : { group: newName.trim() || gc.suggestName('Upload', new Date().toISOString()) }) });
      setNaming(false);
      if (!cur && r.group) setGid(r.group.id);
      rt.terminal.log('ui-review', `uploaded ${r.shots.length} screenshot(s)`, 'ok');
      rt.toast(`Uploaded ${r.shots.length} screenshot${r.shots.length === 1 ? '' : 's'}`, 'success');
      await load();
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  if (!shots) return <LoadingSkeleton rows={6} label="Loading screenshots" />;

  const picker = <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void upload(e.target.files)} />;
  if (!cur) {
    const gcols: GridColumn<GroupRow>[] = [
      { id: 'name', label: 'Group', width: 'minmax(calc(var(--fx-font-size) * 12), 3fr)', fixed: true, sortable: true, sortValue: (g) => g.name.toLowerCase(),
        render: (g) => <span className="axp-ui-review__srow">{g.cover ? <Pic id={g.cover.id} alt="" className="axp-ui-review__mini" /> : <span className="axp-ui-review__noimg axp-ui-review__mini" />}<span className="axp-ui-review__title"><b>{g.name}</b>{g.apps.length > 0 && <span className="fx-small fx-muted">{g.apps.join(', ')}</span>}</span></span> },
      { id: 'date', label: 'Made', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (g) => g.createdAt, render: (g) => <span className="fx-small" title={g.createdAt}>{fmtDate(g.createdAt)}</span> },
      { id: 'count', label: 'Shots', width: 'calc(var(--fx-font-size) * 4)', sortable: true, sortValue: (g) => g.count, render: (g) => <span className="fx-small">{g.count}</span> },
      { id: 'source', label: 'Source', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (g) => g.source || g.cover?.source || '', render: (g) => <span className="fx-small axp-ui-review__clip">{g.session || g.build || sc.sourceInfo(g.source || g.cover?.source || '').label}</span> },
    ];
    const sorted = sort?.col === 'date' && sort.dir === -1 ? shownGroups : [...shownGroups].sort((a, b) => {
      const c = gcols.find((x) => x.id === sort?.col)?.sortValue; if (!c || !sort) return 0;
      const va = c(a), vb = c(b); return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
    return (
      <div className="fx-stack axp-ui-review__shots">
        {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
        <div className="axp-ui-review__bar" role="toolbar" aria-label="Screenshot groups: search and view">
          <input className="fx-input axp-ui-review__search" value={gq} onChange={(e) => setGq(e.target.value)} placeholder="Search groups: name, date (Oct 31, 2026-10-31), app, source…" aria-label="Search groups" />
          <Segmented<Mode> size="sm" label="Layout" value={mode} onChange={setMode} options={[{ value: 'grid', label: 'Grid', icon: 'list' }, { value: 'thumbs', label: 'Thumbnails', icon: 'grid' }]} />
          {picker}
          <Button size="sm" tone="primary" icon="upload" busy={busy} disabled={busy} aria-pressed={naming} onClick={() => { setNewName(gc.suggestName('Upload', new Date().toISOString())); setNaming(!naming); }}>Upload</Button>
          <IconButton icon="refresh" label="Reload screenshots" onClick={() => void load()} />
        </div>
        {naming && (
          <div className="axp-ui-review__gtool">
            <TextField label="Name the group for these screenshots" value={newName} onChange={setNewName} autoFocus />
            <Button size="sm" tone="primary" icon="upload" busy={busy} disabled={busy || !newName.trim()} onClick={() => input.current?.click()}>Pick pictures</Button>
          </div>
        )}
        <p className="fx-small fx-muted axp-ui-review__countline">{shownGroups.length} of {groupRows.length} group{groupRows.length === 1 ? '' : 's'} · {everything.length} screenshot{everything.length === 1 ? '' : 's'} · newest first; tap a group for its shots.</p>
        {shownGroups.length === 0 ? (
          <EmptyState icon="monitor">{groupRows.length ? 'No group matches. Clear the search.' : 'No screenshots yet. Upload some, or save them from a session with axf shot <file> --group "Breakroom check - Oct 31 8:20 PM".'}</EmptyState>
        ) : mode === 'thumbs' ? (
          <div className="axp-ui-review__thumbs">
            {sorted.map((g) => (
              <button key={g.id} type="button" data-fx-row className={`axp-ui-review__tcard is-${g.cover?.viewport ?? 'desktop'}`} onClick={() => openGroup(g.id)} title={g.name}>
                {g.cover ? <Pic id={g.cover.id} alt="" className="axp-ui-review__big" /> : <span className="axp-ui-review__noimg axp-ui-review__big" />}
                <span className="axp-ui-review__tcap fx-small"><b>{g.name}</b><span className="fx-muted">{fmtDate(g.createdAt)} · {g.count}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <DataGrid<GroupRow> id="ui-review-shot-groups" label="Screenshot groups" groups={[{ id: 'all', title: 'Groups', icon: 'layers', collapsed: false, rows: sorted, groups: [], counts: <span className="fx-small fx-muted">{sorted.length}</span> }]}
            columns={gcols} rowId={(g) => g.id} rowLabel={(g) => g.name} hidden={hidden.filter((h) => h !== 'count')} onToggleColumn={(c) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))} onShowAll={() => setHidden([])}
            sort={sort} onSort={(c) => setSort((s) => (!c ? null : s?.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: c === 'date' ? -1 : 1 }))}
            onRowClick={(g) => openGroup(g.id)} rowTone={() => 'muted'} compact />
        )}
      </div>
    );
  }

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
      <GroupHead g={cur} groups={groupRows} picked={picked} selecting={selecting} onBack={() => openGroup(null)} onSelecting={setSelecting} onPick={setPicked} act={gact} />
      <div className="axp-ui-review__bar" role="toolbar" aria-label="Screenshots: filter and view">
        <input className="fx-input axp-ui-review__search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: title, app, screen, session, #PR…" aria-label="Search screenshots" />
        {apps.length > 0 && <select className="fx-input axp-ui-review__sel" value={app} onChange={(e) => setApp(e.target.value)} aria-label="App"><option value="">Every app</option>{apps.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
        <select className="fx-input axp-ui-review__sel" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source"><option value="">Every source</option>{sc.SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select className="fx-input axp-ui-review__sel" value={viewport} onChange={(e) => setViewport(e.target.value)} aria-label="Device"><option value="">Phone + desktop</option><option value="phone">Phone</option><option value="desktop">Desktop</option></select>
        <select className="fx-input axp-ui-review__sel" value={by} onChange={(e) => setBy(e.target.value as GroupBy)} aria-label="Group by">{sc.GROUPS.map((g) => <option key={g.id} value={g.id}>{g.id === 'none' ? g.label : `By ${g.label.toLowerCase()}`}</option>)}</select>
        <Segmented<Mode> size="sm" label="Layout" value={mode} onChange={setMode} options={[{ value: 'grid', label: 'Grid', icon: 'list' }, { value: 'thumbs', label: 'Thumbnails', icon: 'grid' }]} />
        {picker}
        <Button size="sm" tone="primary" icon="upload" busy={busy} disabled={busy} onClick={() => input.current?.click()}>Upload</Button>
        <IconButton icon="refresh" label="Reload screenshots" onClick={() => void load()} />
      </div>
      <p className="fx-small fx-muted axp-ui-review__countline">{rows.length} of {all.length} screenshot{all.length === 1 ? '' : 's'} in this group · not waiting for approval; Send to review puts one in the queue.</p>

      {rows.length === 0 ? (
        <EmptyState icon="monitor">{all.length ? 'Nothing matches. Clear the search or the filters.' : 'No screenshots yet. Upload one, or save them from a session with axf shot <file> --title "…" --app … --source check.'}</EmptyState>
      ) : mode === 'thumbs' ? (
        <div className="fx-stack axp-ui-review__tgroups">
          {groups.map((g) => (
            <section key={g.id} className="axp-ui-review__tgroup" aria-label={g.label}>
              {by !== 'none' && <h3 className="axp-ui-review__thead fx-small">{g.label} <span className="fx-muted">{g.shots.length}</span></h3>}
              <div className="axp-ui-review__thumbs">
                {g.shots.map((s) => (
                  <button key={s.id} type="button" data-fx-row className={`axp-ui-review__tcard is-${s.viewport}${picked.includes(s.id) ? ' is-picked' : ''}`} aria-pressed={selecting ? picked.includes(s.id) : undefined} onClick={() => open(s, g.shots)} title={s.title}>
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
          multi={selecting ? picked : undefined} onRowClick={(s) => open(s, rows)} rowTone={(s) => (s.promoted.length ? 'accent' : s.pair ? 'info' : 'muted')} compact />
      )}

      {viewing && viewList.length > 0 && <Viewer list={viewList} index={viewing.i} all={all} onIndex={(i) => setViewing({ ...viewing, i })} onClose={() => setViewing(null)} act={act} />}
    </div>
  );
}
