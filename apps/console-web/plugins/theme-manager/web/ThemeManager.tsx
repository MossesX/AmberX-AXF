/*
 * Theme manager: roll colour / style / layout themes (or everything themeable), choosing which tokens change in a
 * tree with tri-state checkboxes and locks, preview live, undo / redo, pin favourites, edit any value by hand, save
 * a roll as a standard asset (asset@1) and manage saved ones. Works only with the existing asset types and engines.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, IconButton, Switch, useAxfState, useEditorSync, useRuntime } from '@console/axf/react';
import { assetTypeSpecs, hideable } from '@console/axf/core';
import type { AssetType, AxfRuntime } from '@console/axf/core';
import { PRESETS, allLeafIds, buildTree, getAt, leaves, readability, rollType, setAt, toggle, triState, type Json, type Node, type TypeSpec } from './rollEngine';
import { call, del, post, put, type SavedTheme } from './api';
import { MoreMenu } from './MoreMenu';

const P = 'axp-theme-manager';
type Data = Record<string, Json>;
type Snap = Record<string, Data>;

/* ---------------- preview (shared by every copy of the view) ---------------- */
const flips: Record<string, boolean> = {};
export function applyPreview(rt: AxfRuntime, type: string, data: Data): string | null {
  flips[type] = !flips[type];
  const id = `tm-preview-${type}-${flips[type] ? 'a' : 'b'}`;
  const r = rt.registry.register({ $axf: 'asset@1', type, id, name: 'Unsaved roll', version: '1.0.0', description: 'Theme manager preview (not saved)', author: 'Theme manager', tags: ['preview'], data }, 'app', 'theme-manager');
  if (!r.ok) return r.errors?.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; ') || 'invalid asset';
  rt.swap(type as never, id);
  return null;
}

const store: { history: Snap[]; index: number; base: Record<string, string> } = { history: [], index: -1, base: {} };
let snapStore = { ...store };
const subs = new Set<() => void>();
const emit = () => { snapStore = { ...store }; subs.forEach((f) => f()); };
const useHistory = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snapStore, () => snapStore);

const LS = { ticked: 'axf-tm:ticked', locked: 'axf-tm:locked', pins: 'axf-tm:pins', last: 'axf-tm:last-applied' };
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
export const rememberApplied = (type: string, id: string) => write(LS.last, { ...read<Record<string, string>>(LS.last, {}), [type]: id });
export const lastApplied = () => read<Record<string, string>>(LS.last, {});

function useNarrow() {
  const q = '(max-width: 640px)';
  const [n, setN] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => setN(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return n;
}

export function ThemeManager() {
  const rt = useRuntime();
  const ax = useAxfState();
  const hist = useHistory();
  const narrow = useNarrow();
  const types = useMemo(() => Object.keys(assetTypeSpecs).filter((t) => t !== 'uac-policy'), []);
  const active = useMemo(() => Object.fromEntries(types.map((t) => [t, (rt.asset(t as never) as unknown as { data: Data }).data])) as Snap, [rt, types, ax.active]); // eslint-disable-line react-hooks/exhaustive-deps
  const assets = useMemo(() => Object.fromEntries(types.map((t) => [t, rt.registry.list(t as never).filter((a) => !String(a.id).startsWith('tm-preview-')) as unknown as { data: Data }[]])), [rt, types, ax.active]); // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildTree(assetTypeSpecs as unknown as Record<string, TypeSpec>, assets, active, types), [assets, active, types]);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(read<string[] | null>(LS.ticked, null) ?? PRESETS['colors only']!(buildTree(assetTypeSpecs as unknown as Record<string, TypeSpec>, assets, active, types))));
  const [locked, setLocked] = useState<Set<string>>(() => new Set(read<string[]>(LS.locked, [])));
  const [open, setOpen] = useState<Set<string>>(() => new Set(['color-theme']));
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [path, setPath] = useState<string[]>([]); // phone drill-down
  const [err, setErr] = useState('');
  const [presets, setPresets] = useState<Record<string, string[]>>({});
  const [savingPreset, setSavingPreset] = useState(false);
  const [pins, setPins] = useState<{ name: string; at: number; snap: Snap }[]>(() => read(LS.pins, []));
  // UI-editor rule: on open / load / focus, reload current values (active themes via rt.refreshFromSaved, own picks from storage); last save wins.
  useEditorSync({ onRefresh: () => {
    const t = read<string[] | null>(LS.ticked, null); if (t) setTicked(new Set(t));
    setLocked(new Set(read<string[]>(LS.locked, [])));
    setPins(read(LS.pins, []));
  } });
  useEffect(() => write(LS.ticked, [...ticked]), [ticked]);
  useEffect(() => write(LS.locked, [...locked]), [locked]);
  useEffect(() => write(LS.pins, pins), [pins]);
  useEffect(() => { void call<{ presets: Record<string, string[]> }>('presets').then((r) => setPresets(r.presets), () => undefined); }, []);

  const byId = useMemo(() => { const m = new Map<string, Node>(); const w = (n: Node) => { m.set(n.id, n); n.children.forEach(w); }; tree.forEach(w); return m; }, [tree]);
  const filtered = useMemo(() => {
    if (!q.trim()) return tree;
    const ql = q.toLowerCase();
    const f = (n: Node): Node | null => { const kids = n.children.map(f).filter((x): x is Node => !!x); return n.label.toLowerCase().includes(ql) || n.id.toLowerCase().includes(ql) || kids.length ? { ...n, children: kids.length || n.leaf ? kids : n.children } : null; };
    return tree.map(f).filter((x): x is Node => !!x);
  }, [tree, q]);

  const snapshot = (): Snap => Object.fromEntries(types.map((t) => [t, structuredClone(active[t]!)]));
  const push = (s: Snap) => { store.history = [...store.history.slice(0, store.index + 1), s].slice(-50); store.index = store.history.length - 1; emit(); };
  const applySnap = (s: Snap) => {
    const problems: string[] = [];
    for (const [t, data] of Object.entries(s)) {
      if (JSON.stringify(data) === JSON.stringify(active[t])) continue;
      if (!store.base[t]) store.base[t] = ax.active[t as never] as string;
      const e = applyPreview(rt, t, data);
      if (e) problems.push(`${t}: ${e}`);
    }
    setErr(problems.join(' · '));
  };
  const roll = (which: string[]) => {
    if (store.index < 0) push(snapshot());
    const next = snapshot();
    for (const t of which) next[t] = rollType(t, tree, next[t]!, { ticked, locked });
    applySnap(next); push(next);
  };
  const undo = () => { if (hist.index > 0) { store.index -= 1; applySnap(store.history[store.index]!); emit(); } };
  const redo = () => { if (hist.index < hist.history.length - 1) { store.index += 1; applySnap(store.history[store.index]!); emit(); } };
  const revert = () => { for (const [t, id] of Object.entries(store.base)) rt.swap(t as never, id); store.base = {}; store.history = []; store.index = -1; emit(); setErr(''); };
  const edit = (leafId: string, v: Json) => {
    const n = byId.get(leafId); if (!n?.leaf) return;
    if (store.index < 0) push(snapshot());
    const next = snapshot();
    next[n.type] = setAt(next[n.type]!, n.leaf.path, v);
    applySnap(next); push(next);
  };
  // A hidden slot (Show/Hide switch on its row = Appearance → Assets → Hidden) is greyed out and never rolled.
  const isHidden = (t: string) => rt.slotHidden(t as AssetType);
  const rollable = (t: string) => !isHidden(t) && leaves(tree.find((n) => n.type === t) ?? { id: '', label: '', type: t, children: [] }).some((l) => ticked.has(l.id) && !locked.has(l.id));
  const changed = types.filter((t) => store.base[t]);
  const colorProblems = active['color-theme'] ? readability(active['color-theme']) : [];

  /* tree rendering */
  const Row = ({ n, depth }: { n: Node; depth: number }) => {
    const st = triState(n, ticked);
    const isOpen = open.has(n.id) || !!q.trim();
    const lockedLeaf = n.leaf && locked.has(n.id);
    const off = isHidden(n.type);
    const top = n.id === n.type || depth === 0;
    return (
      <li>
        <div className={`${P}__row ${sel === n.id ? 'is-sel' : ''} ${off ? 'is-off' : ''}`} style={{ paddingLeft: `calc(var(--fx-space) * ${depth * 1.25})` }}>
          <input type="checkbox" className={`${P}__tick`} aria-label={`Roll ${n.label}`} checked={st === 'on'} disabled={off} ref={(el) => { if (el) el.indeterminate = st === 'some'; }} onChange={() => setTicked(toggle(n, ticked))} />
          {n.children.length > 0 ? (
            <button type="button" data-fx-row className={`${P}__twisty`} aria-expanded={isOpen} onClick={() => (narrow ? setPath([...path, n.id]) : setOpen((o) => { const x = new Set(o); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; }))}>
              <Icon name={narrow ? 'chevron-right' : isOpen ? 'chevron-down' : 'chevron-right'} size={13} />{n.icon && <Icon name={n.icon} size={13} />}<span>{n.label}</span>
            </button>
          ) : (
            <button type="button" data-fx-row className={`${P}__twisty`} onClick={() => setSel(n.id)}>
              {n.leaf?.kind === 'color' && <span className={`${P}__swatch`} style={{ background: String(getAt(active[n.type] ?? {}, n.leaf.path) ?? '') }} aria-hidden />}
              <span>{n.label}</span>
              <span className="fx-small fx-muted fx-mono">{String(getAt(active[n.type] ?? {}, n.leaf?.path ?? '') ?? '').slice(0, 28)}</span>
            </button>
          )}
          {n.leaf && <button type="button" className={`fx-iconbtn ${P}__lock ${lockedLeaf ? 'is-active' : ''}`} title={lockedLeaf ? 'Locked: never rolled' : 'Lock (keep this value when rolling)'} aria-pressed={!!lockedLeaf} onClick={() => setLocked((l) => { const x = new Set(l); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}><Icon name="lock" size={12} /></button>}
          {!n.leaf && !narrow && <button type="button" className={`fx-chip ${P}__only`} title="Tick only this branch" onClick={() => setTicked(new Set(leaves(n).map((l) => l.id)))}>only</button>}
          {top && !n.leaf && hideable(n.type) && (
            <Switch hideLabel className={`${P}__hide`} label={`Show ${n.label}`} text={off ? 'Hidden' : 'Shown'} title={off ? `${n.label} is hidden: it isn't drawn and rolls skip it` : `Hide ${n.label} from the screen`}
              checked={!off} disabled={rt.gate('assets.swap') !== 'allow'} onChange={(on) => rt.setSlotHidden(n.type as AssetType, !on)} />
          )}
        </div>
        {!narrow && isOpen && n.children.length > 0 && <ul className={`${P}__tree`}>{n.children.map((c) => <Row key={c.id} n={c} depth={depth + 1} />)}</ul>}
      </li>
    );
  };
  const current = narrow && path.length ? byId.get(path[path.length - 1]!) : null;
  const shownNodes = narrow && current ? current.children : filtered;
  const selNode = sel ? byId.get(sel) : null;

  return (
    <div className={`${P} fx-stack`}>
      {/* one toolbar: the two rolls used most, undo / redo / pin, the rest behind ⋯ (compact pages, Oct 30 2026) */}
      <div className={`${P}__bar ${P}__toolbar`} role="toolbar" aria-label="Roll">
        <Button tone="primary" size="sm" icon="shuffle" onClick={() => roll(types.filter(rollable))}>Roll ticked</Button>
        <Button size="sm" icon="palette" disabled={!rollable('color-theme')} onClick={() => roll(['color-theme'])}>Colours</Button>
        <IconButton icon="undo" label="Undo" disabled={hist.index <= 0} onClick={undo} />
        <IconButton icon="redo" label="Redo" disabled={hist.index >= hist.history.length - 1} onClick={redo} />
        <IconButton icon="star" label="Pin this roll" disabled={!changed.length} onClick={() => setPins([{ name: `Favourite ${pins.length + 1}`, at: Date.now(), snap: snapshot() }, ...pins].slice(0, 12))} />
        <MoreMenu label="More roll actions" items={[
          { id: 'style', label: 'Roll style theme', icon: 'type', disabled: !rollable('style-theme'), onSelect: () => roll(['style-theme']) },
          { id: 'layout', label: 'Roll layout', icon: 'layout', disabled: !rollable('layout'), onSelect: () => roll(['layout']) },
          { id: 'revert', label: 'Back to the saved look', icon: 'x', disabled: !changed.length, onSelect: revert },
        ]} />
        <span className="fx-grow" />
        {changed.length > 0 && <Chip tone="warning">unsaved: {changed.join(', ')}</Chip>}
      </div>
      {err && <p className={`${P}__bad`}>{err}</p>}
      {colorProblems.length > 0 && <p className={`${P}__warn`}><Icon name="alert" size={13} /> Hard to read: {colorProblems.join(' · ')}</p>}
      {pins.length > 0 && (
        <div className={`${P}__pins`}>
          {pins.map((p, i) => (
            <span key={p.at} className={`${P}__pin`}>
              <button type="button" className="fx-chip fx-chip--accent" onClick={() => { applySnap(p.snap); push(p.snap); }} title="Apply this pinned roll"><Icon name="star" size={12} /> {p.name}</button>
              <button type="button" className="fx-iconbtn" aria-label={`Unpin ${p.name}`} onClick={() => setPins(pins.filter((_, j) => j !== i))}><Icon name="x" size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <SaveBox changed={changed} active={active} onSaved={() => { store.base = {}; store.history = []; store.index = -1; emit(); }} />

      <div className={`${P}__main`}>
        <section className={`${P}__treebox`}>
          <div className={`${P}__bar`}>
            <input className="fx-input fx-grow" placeholder="Filter the tree" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter the tree" />
            <select className={`fx-input ${P}__tickpick`} aria-label="Tick a preset" value="" onChange={(e) => {
              const v = e.target.value; e.target.value = '';
              if (v === '+save') setSavingPreset(true);
              else if (v === 'invert') setTicked(new Set(allLeafIds(tree).filter((x) => !ticked.has(x))));
              else if (v.startsWith('p:')) setTicked(new Set(PRESETS[v.slice(2)]!(tree)));
              else if (v.startsWith('s:')) setTicked(new Set(presets[v.slice(2)] ?? []));
            }}>
              <option value="">Tick…</option>
              {Object.keys(PRESETS).map((k) => <option key={k} value={`p:${k}`}>{k}</option>)}
              <option value="invert">invert</option>
              {Object.keys(presets).length > 0 && <optgroup label="Saved presets">{Object.keys(presets).map((k) => <option key={k} value={`s:${k}`}>{k}</option>)}</optgroup>}
              <option value="+save">+ save as preset…</option>
            </select>
          </div>
          {savingPreset && <PresetSaver ticked={ticked} presets={presets} setPresets={setPresets} onDone={() => setSavingPreset(false)} />}
          {narrow && path.length > 0 && (
            <div className={`${P}__crumbs`}>
              <Button tone="ghost" size="sm" icon="arrow-left" onClick={() => setPath(path.slice(0, -1))}>Back</Button>
              <span className="fx-small fx-muted">{path.map((p) => byId.get(p)?.label).join(' › ')}</span>
            </div>
          )}
          <ul className={`${P}__tree`}>{shownNodes.map((n) => <Row key={n.id} n={n} depth={0} />)}</ul>
          <p className="fx-small fx-muted" title="New asset types show up here by themselves.">{ticked.size} of {allLeafIds(tree).length} ticked · {locked.size} locked</p>
        </section>
        <section className={`${P}__editor`}>
          {!selNode?.leaf ? <p className="fx-small fx-muted">Pick a value in the tree to see it and edit it by hand (live preview).</p> : (
            <ValueEditor key={selNode.id} node={selNode} value={getAt(active[selNode.type] ?? {}, selNode.leaf.path) ?? null} onChange={(v) => edit(selNode.id, v)} />
          )}
        </section>
      </div>
      <SavedThemes onApply={(t, id) => { store.base = {}; store.history = []; store.index = -1; emit(); rt.swap(t as never, id); rememberApplied(t, id); }} />
    </div>
  );
}

function ValueEditor({ node, value, onChange }: { node: Node; value: Json; onChange: (v: Json) => void }) {
  const f = node.leaf!;
  const [v, setV] = useState<Json>(value);
  useEffect(() => setV(value), [value]);
  const commit = (x: Json) => { setV(x); onChange(x); };
  const hex = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  return (
    <div className="fx-stack">
      <strong>{node.label} <span className="fx-small fx-muted fx-mono">{node.type} · {f.path}</span></strong>
      {f.kind === 'enum' && <select className="fx-input" value={String(v)} onChange={(e) => commit(e.target.value)}>{f.enum!.map((x) => <option key={x}>{x}</option>)}</select>}
      {f.kind === 'bool' && <label className={`${P}__opt`}><input type="checkbox" checked={!!v} onChange={(e) => commit(e.target.checked)} /> {v ? 'on' : 'off'}</label>}
      {f.kind === 'number' && (
        <>
          <input className="fx-input" type="number" value={Number(v)} step={Number.isInteger(v) ? 1 : 0.01} onChange={(e) => commit(Number(e.target.value))} />
          {f.range && f.range[0] !== f.range[1] && <input type="range" min={f.range[0]} max={f.range[1]} step={Number.isInteger(f.range[0]) && Number.isInteger(f.range[1]) ? 1 : 0.01} value={Number(v)} onChange={(e) => commit(Number(e.target.value))} aria-label={`${node.label} slider`} />}
          {f.range && <span className="fx-small fx-muted">Rolls stay between {f.range[0]} and {f.range[1]} (what the known themes use).</span>}
        </>
      )}
      {f.kind === 'color' && (
        <div className={`${P}__bar`}>
          {hex && <input type="color" value={hex} onChange={(e) => commit(e.target.value)} aria-label={`${node.label} colour`} />}
          <input className="fx-input fx-mono fx-grow" value={String(v ?? '')} onChange={(e) => setV(e.target.value)} onBlur={() => commit(String(v))} />
        </div>
      )}
      {f.kind === 'string' && (
        <>
          <input className="fx-input" value={String(v ?? '')} onChange={(e) => setV(e.target.value)} onBlur={() => commit(String(v))} />
          {!!f.values?.length && <select className="fx-input" value="" onChange={(e) => e.target.value && commit(JSON.parse(e.target.value) as Json)} aria-label="Values other themes use"><option value="">Values other themes use…</option>{f.values.map((x) => <option key={JSON.stringify(x)} value={JSON.stringify(x)}>{String(x).slice(0, 60)}</option>)}</select>}
        </>
      )}
    </div>
  );
}

function PresetSaver({ ticked, presets, setPresets, onDone }: { ticked: Set<string>; presets: Record<string, string[]>; setPresets: (p: Record<string, string[]>) => void; onDone: () => void }) {
  const [name, setNameState] = useState('');
  const setName = (v: string | null) => { if (v === null) onDone(); else setNameState(v); };
  const save = async () => { const r = await put<{ presets: Record<string, string[]> }>('presets', { ...presets, [name.trim()]: [...ticked] }); setPresets(r.presets); setName(null); };
  return (
    <form className={`${P}__bar`} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }}>
      <input className={`fx-input ${P}__narrow`} autoFocus placeholder="menus only" value={name} onChange={(e) => setName(e.target.value)} aria-label="Preset name" />
      <Button size="sm" tone="primary" icon="save" disabled={!name.trim()} onClick={() => void save()}>Save</Button>
      <Button size="sm" tone="ghost" onClick={() => setName(null)}>Cancel</Button>
      {Object.keys(presets).length > 0 && <Button size="sm" tone="ghost" icon="trash" title="Delete a saved preset with this name" disabled={!presets[name.trim()]} onClick={() => { const p = { ...presets }; delete p[name.trim()]; void put<{ presets: Record<string, string[]> }>('presets', p).then((r) => { setPresets(r.presets); setName(null); }); }}>Delete</Button>}
    </form>
  );
}

function SaveBox({ changed, active, onSaved }: { changed: string[]; active: Snap; onSaved: () => void }) {
  const rt = useRuntime();
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [msg, setMsg] = useState('');
  if (!changed.length) return null;
  const save = async () => {
    setMsg('Saving…');
    try {
      for (const t of changed) {
        const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'roll';
        const asset = { $axf: 'asset@1', type: t, id: `${slug}-${t}`.slice(0, 60), name: `${name.trim() || 'Rolled'} (${(assetTypeSpecs as unknown as Record<string, { label?: string }>)[t]?.label ?? t})`, version: '1.0.0',
          description: 'Rolled in the theme manager', author: 'Brett', tags: ['rolled', ...tags.split(',').map((x) => x.trim()).filter(Boolean)], data: active[t] };
        const r = await post<{ asset: SavedTheme }>('themes', { asset });
        const reg = rt.registry.register(r.asset, 'imported', 'theme-manager');
        if (!reg.ok) throw new Error(`${t}: not a valid asset`);
        rt.swap(t as never, r.asset.id); rememberApplied(t, r.asset.id);
      }
      setMsg(''); setName(''); setTags(''); onSaved();
      rt.toast(`Saved ${changed.length} theme asset${changed.length > 1 ? 's' : ''}`, 'success', 'Theme manager');
      globalThis.dispatchEvent(new Event('axf:tm-saved'));
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <form className={`${P}__save`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Icon name="save" size={14} />
      <input className="fx-input" placeholder="Name this look" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <input className="fx-input" placeholder="tags (comma)" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
      <Button size="sm" tone="primary" icon="save" disabled={!name.trim()} onClick={() => void save()}>Save as asset{changed.length > 1 ? 's' : ''}</Button>
      {msg && <span className="fx-small">{msg}</span>}
    </form>
  );
}

function SavedThemes({ onApply }: { onApply: (type: string, id: string) => void }) {
  const rt = useRuntime();
  const [items, setItems] = useState<SavedTheme[] | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [name, setName] = useState('');
  const load = () => call<{ items: SavedTheme[] }>('themes').then((r) => setItems(r.items), () => setItems([]));
  useEffect(() => { void load(); const f = () => void load(); globalThis.addEventListener('axf:tm-saved', f); return () => globalThis.removeEventListener('axf:tm-saved', f); }, []);
  const key = (a: SavedTheme) => `${a.type}/${a.id}`;
  const rename = async (a: SavedTheme) => { const r = await put<{ asset: SavedTheme }>(`themes/${a.type}/${a.id}`, { ...a, name }); rt.registry.register(r.asset, 'imported', 'theme-manager'); setEdit(null); void load(); };
  const dup = async (a: SavedTheme) => { const r = await post<{ asset: SavedTheme }>('themes', { asset: { ...a, id: `${a.id}-copy`.slice(0, 60), name: `${a.name} (copy)` } }); rt.registry.register(r.asset, 'imported', 'theme-manager'); void load(); };
  const remove = async (a: SavedTheme) => {
    if ((rt.getState().active as Record<string, string>)[a.type] === a.id) { rt.toast('Apply another theme first; this one is in use', 'warning'); return; }
    await del(`themes/${a.type}/${a.id}`); void load();
  };
  const exportOne = (a: SavedTheme) => { const b = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const l = document.createElement('a'); l.href = u; l.download = `${a.type}.${a.id}.json`; l.click(); URL.revokeObjectURL(u); };
  const importFile = async (f: File) => {
    try { const r = await post<{ asset: SavedTheme }>('themes', { asset: JSON.parse(await f.text()) }); rt.registry.register(r.asset, 'imported', 'theme-manager'); rt.toast(`Imported ${r.asset.name}`, 'success'); void load(); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  return (
    <section className="fx-stack">
      <div className={`${P}__bar`}>
        <strong className="fx-grow">Saved themes</strong>
        <label className="fx-chip"><Icon name="upload" size={12} /> Import asset JSON<input type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} /></label>
      </div>
      {items && !items.length && <p className="fx-small fx-muted" title="Saved themes are standard asset@1 files every AXF app and port can load.">Nothing saved yet: roll something you like, then “Save as asset”.</p>}
      <ul className={`${P}__saved`}>
        {(items ?? []).map((a) => (
          <li key={key(a)}>
            {edit === key(a)
              ? <form className={`${P}__bar fx-grow`} onSubmit={(e) => { e.preventDefault(); void rename(a); }}><input className="fx-input fx-grow" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="New name" /><Button size="sm" tone="primary" onClick={() => void rename(a)}>Rename</Button></form>
              : <span className={`${P}__savedname`} title={`${a.type} · ${a.id}${a.tags?.length ? ` · ${a.tags.join(', ')}` : ''}`}><strong>{a.name}</strong> <span className="fx-small fx-muted">{a.type}{a.tags?.length ? ` · ${a.tags.join(', ')}` : ''}</span></span>}
            <Button size="sm" tone="ghost" icon="check" onClick={() => onApply(a.type, a.id)}>Apply</Button>
            <MoreMenu label={`More for ${a.name}`} items={[
              { id: 'rename', label: 'Rename', icon: 'edit', onSelect: () => { setEdit(key(a)); setName(a.name); } },
              { id: 'dup', label: 'Duplicate', icon: 'copy', onSelect: () => void dup(a) },
              { id: 'export', label: 'Export', icon: 'download', onSelect: () => exportOne(a) },
              { id: 'delete', label: 'Delete', icon: 'trash', onSelect: () => void remove(a) },
            ]} />
          </li>
        ))}
      </ul>
      {!!items?.length && <p className="fx-small fx-muted">To edit one: apply it, change values in the tree, save under the same name.</p>}
    </section>
  );
}
