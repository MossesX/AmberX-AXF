import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Container, IconButton, ICON_NAMES, MenuList, Note, Segmented, SelectField, Slider, Switch, TextField, useRuntime } from '@console/axf/react';
import type { MenuItem } from '@console/axf/core';
import {
  ASSET_PREFIX, COLOR_KEYS, COLOR_TOKENS, FONTS, FONT_STYLES, VARIANTS, WEIGHTS, asChunk, compile, designErrors, findChunk, freeId, getAt,
  insertAt, moveAt, newDesign, nextEntryId, normalizeDesign, removeAt, styleSheet, updateAt, usedBy,
  type CompiledItem, type Design, type Entry, type MenuStyle, type Path,
} from './core';
import { deleteDesign, getDesigns, isLoaded, loadDesigns, loadError, saveDesign, subscribe } from './store';

const COLOR_LABEL: Record<(typeof COLOR_KEYS)[number], string> = { color: 'Text colour', background: 'Background', hoverColor: 'Hover text colour', hoverBackground: 'Hover background' };
const FONT_LABEL: Record<string, string> = { '': 'Theme font', display: 'Theme display font', mono: 'Theme mono font' };

function useDesigns(): Design[] {
  return useSyncExternalStore(subscribe, getDesigns, getDesigns);
}

/** A colour: none, one of the theme's colours, or a colour you pick. */
function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const mode = value === '' ? '' : value.startsWith('token:') ? value : 'custom';
  return (
    <div className="axp-ctxd-color">
      <SelectField
        label={label}
        value={mode}
        empty="Not set"
        options={[...COLOR_TOKENS.map((t) => ({ value: `token:${t}`, label: `Theme: ${t}` })), { value: 'custom', label: 'Pick a colour…' }]}
        onChange={(v) => onChange(v === 'custom' ? (value.startsWith('#') ? value : '#808080') : v)} // theme-ok: the colour input's starting value
      />
      {mode === 'custom' && <input aria-label={`${label}: colour`} type="color" className="fx-input axp-ctxd-color__input" value={value} onChange={(e) => onChange(e.target.value)} />}
      {value !== '' && <span className="axp-ctxd-swatch" style={{ background: value.startsWith('token:') ? `var(--fx-${value.slice(6)})` : value }} />}
    </div>
  );
}

function StyleEditor({ style, onChange, disabled }: { style: MenuStyle; onChange: (s: MenuStyle) => void; disabled?: boolean }) {
  const set = <K extends keyof MenuStyle>(k: K, v: MenuStyle[K]) => onChange({ ...style, [k]: v });
  return (
    <fieldset className="axp-ctxd-style" disabled={disabled}>
      <SelectField label="Font" value={style.font} options={FONTS.map((f) => ({ value: f, label: FONT_LABEL[f] ?? f }))} onChange={(v) => set('font', v)} />
      <Slider label={style.size ? 'Font size' : 'Font size (theme)'} value={style.size || 100} min={60} max={200} step={5} unit="%" onChange={(v) => set('size', v === 100 ? 0 : v)} />
      <SelectField label="Font weight" value={style.weight} options={WEIGHTS.map((w) => ({ value: w, label: w || 'Theme' }))} onChange={(v) => set('weight', v as MenuStyle['weight'])} />
      <SelectField label="Font style" value={style.fontStyle} options={FONT_STYLES.map((w) => ({ value: w, label: w || 'Theme' }))} onChange={(v) => set('fontStyle', v as MenuStyle['fontStyle'])} />
      {COLOR_KEYS.map((k) => <ColorPick key={k} label={COLOR_LABEL[k]} value={style[k]} onChange={(v) => set(k, v)} />)}
    </fieldset>
  );
}

/** The entry tree: rows you tap to select, nested items indented. */
function EntryRows({ entries, path, selected, onSelect, all }: { entries: Entry[]; path: Path; selected: Path | null; onSelect: (p: Path) => void; all: Design[] }) {
  return (
    <ul className="axp-ctxd-tree">
      {entries.map((e, i) => {
        const p = [...path, i];
        const on = selected?.join('.') === p.join('.');
        const chunk = e.kind === 'chunk' ? findChunk(e.chunk, all) : undefined;
        return (
          <li key={e.id}>
            <button type="button" data-fx-row className={`axp-ctxd-row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onSelect(p)}>
              {e.kind === 'separator' && <span className="axp-ctxd-row__sep">— separator —</span>}
              {e.kind === 'chunk' && <span><strong>Chunk:</strong> {chunk?.name ?? e.chunk}{!chunk && ' (missing)'}</span>}
              {e.kind === 'item' && <span>{e.label || 'Untitled'}{e.action ? <small className="axp-ctxd-muted"> · {e.action}</small> : null}{e.items?.length ? <small className="axp-ctxd-muted"> · {e.items.length} inside</small> : null}</span>}
            </button>
            {e.kind === 'item' && e.items?.length ? <EntryRows entries={e.items} path={p} selected={selected} onSelect={onSelect} all={all} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Floating live preview: drag it by its bar; it re-renders on every change of the draft. */
function Preview({ draft, all, onClose }: { draft: Design; all: Design[]; onClose: () => void }) {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({ x: Math.max(8, window.innerWidth - 300), y: Math.max(8, window.innerHeight - 380) }));
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const others = all.filter((d) => d.id !== draft.id);
  // a separate id so the saved version's live styles never paint the preview
  const c = compile({ ...draft, id: `pv-${draft.id}` }, [...others, draft]);
  const strip = (l: CompiledItem[]): MenuItem[] => l.map((i) => ({ ...i, action: undefined, items: i.items ? strip(i.items) : undefined })) as MenuItem[];
  const css = styleSheet(c.styles, '.axp-ctxd-preview');
  return (
    <div className="axp-ctxd-float fx-popover" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Live preview">
      <div
        className="axp-ctxd-float__bar"
        onPointerDown={(e) => { drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setPos({ x: Math.min(window.innerWidth - 80, Math.max(0, e.clientX - drag.current.dx)), y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - drag.current.dy)) }); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <strong>Live preview</strong>
        <IconButton icon="x" label="Close the preview" onClick={onClose} />
      </div>
      <style>{css}</style>
      <div className="axp-ctxd-preview" data-fx-ctx={draft.variant}>
        {c.items.length ? <MenuList items={strip(c.items)} onDone={() => undefined} showIcons={draft.kind === 'chunk' || draft.showIcons} showShortcuts={draft.kind === 'chunk' || draft.showShortcuts} /> : <p className="axp-ctxd-muted">Nothing in it yet.</p>}
      </div>
      {c.errors.length > 0 && <Note tone="warning">{c.errors.join(' ')}</Note>}
    </div>
  );
}

function EntryEditor({ entry, onChange, all }: { entry: Entry; onChange: (patch: Partial<Entry>) => void; all: Design[] }) {
  if (entry.kind === 'separator') return <p className="axp-ctxd-muted">A separator line. Move it or remove it.</p>;
  if (entry.kind === 'chunk') {
    const chunks = all.filter((d) => d.kind === 'chunk');
    return <SelectField label="Chunk" value={findChunk(entry.chunk, all)?.id ?? ''} empty="Pick a chunk" options={chunks.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => onChange({ chunk: v })} />;
  }
  return (
    <div className="axp-ctxd-grid">
      <TextField label="Label" value={entry.label} onChange={(v) => onChange({ label: v })} />
      <SelectField label="Icon" value={entry.icon ?? ''} empty="No icon" options={ICON_NAMES.map((n) => ({ value: n, label: n }))} onChange={(v) => onChange({ icon: v || undefined })} />
      <TextField label="Action" mono value={entry.action ?? ''} placeholder="e.g. edit.copy or nav:settings" onChange={(v) => onChange({ action: v || undefined })} />
      <TextField label="Shortcut" value={entry.shortcut ?? ''} placeholder="e.g. Ctrl+C" onChange={(v) => onChange({ shortcut: v || undefined })} />
    </div>
  );
}

export function Designer() {
  const rt = useRuntime();
  const all = useDesigns();
  const [draft, setDraft] = useState<Design | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<Path | null>(null);
  const [chunkName, setChunkName] = useState('');
  const [saveAsName, setSaveAsName] = useState('');
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => { if (!isLoaded()) void loadDesigns(rt); }, [rt]);

  const open = (d: Design) => { setDraft(normalizeDesign(d)); setDirty(false); setSel(null); setConfirmDel(false); setSaveAsName(''); };
  const change = (patch: Partial<Design>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setDirty(true); };
  const setItems = (items: Entry[]) => change({ items });

  const peers = useMemo(() => (draft ? [...all.filter((d) => d.id !== draft.id), draft] : all), [all, draft]);
  const errors = draft ? designErrors(draft, all) : [];
  const compiled = draft ? compile(draft, peers) : null;
  const saved = draft ? all.find((d) => d.id === draft.id) : undefined;
  const assetId = draft ? `${ASSET_PREFIX}${draft.id}` : '';
  const active = (rt.getState().active as Record<string, string>)['context-menu'];
  const bases = rt.registry.list('context-menu' as never).filter((a) => !a.id.startsWith(ASSET_PREFIX));

  const create = (kind: Design['kind']) => {
    const base = kind === 'menu' ? 'New menu' : 'New chunk';
    const names = new Set(all.filter((x) => x.kind === kind).map((x) => x.name.toLowerCase()));
    let name = base;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    const d = newDesign(kind, name, all.map((x) => x.id));
    if (kind === 'menu') d.base = active && !active.startsWith(ASSET_PREFIX) ? active : bases[0]?.id ?? '';
    setDraft(d); setDirty(true); setSel(null);
  };

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try { await f(); } catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); } finally { setBusy(false); }
  };
  const save = () => run(async () => { if (!draft) return; const s = await saveDesign(rt, draft); open(s); rt.toast(`Saved ${s.name}`, 'success'); });
  const saveAsChunk = () => run(async () => {
    if (!draft || !saveAsName.trim()) return;
    const c = asChunk(draft, saveAsName.trim(), all);
    const errs = designErrors(c, all);
    if (errs.length) throw new Error(errs[0]);
    const s = await saveDesign(rt, c);
    open(s);
    rt.toast(`Saved as chunk ${s.name}`, 'success');
  });
  const duplicate = () => { if (!draft) return; const name = `${draft.name} copy`; setDraft({ ...draft, id: freeId(name, all.map((x) => x.id)), name }); setDirty(true); };
  const remove = () => run(async () => { if (!saved) { setDraft(null); return; } await deleteDesign(rt, saved); setDraft(null); rt.toast(`Deleted ${saved.name}`, 'success'); });
  const use = () => { rt.swap('context-menu' as never, assetId); rt.toast(`${draft?.name} is now the context menu`, 'success'); };

  const selEntry = draft && sel ? getAt(draft.items, sel) : undefined;
  const parentPath = (): Path => (sel ? sel.slice(0, -1) : []);
  const insertIndex = (): number | undefined => (sel ? (sel.at(-1) ?? 0) + 1 : undefined);
  const add = (e: { kind: 'item'; label: string } | { kind: 'separator' } | { kind: 'chunk'; chunk: string }, inside = false) => {
    if (!draft) return;
    const entry = { ...e, id: nextEntryId(draft.items) } as Entry;
    const parent = inside && sel ? sel : parentPath();
    const idx = inside ? undefined : insertIndex();
    const items = insertAt(draft.items, parent, entry, idx);
    setItems(items);
    const list = parent.length ? (getAt(items, parent) as Extract<Entry, { kind: 'item' }>).items ?? [] : items;
    setSel([...parent, idx ?? list.length - 1]);
  };
  const insertChunk = () => {
    if (!draft) return;
    const c = findChunk(chunkName, all);
    if (!c) { rt.toast(`No chunk called "${chunkName}"`, 'warning'); return; }
    if (c.id === draft.id) { rt.toast('A chunk can’t insert itself', 'warning'); return; }
    add({ kind: 'chunk', chunk: c.id });
    setChunkName('');
  };

  const menus = all.filter((d) => d.kind === 'menu');
  const chunks = all.filter((d) => d.kind === 'chunk');
  const ListRows = ({ list }: { list: Design[] }) => (
    <ul className="axp-ctxd-list">
      {list.map((d) => (
        <li key={d.id}>
          <button type="button" data-fx-row className={`axp-ctxd-row${draft?.id === d.id ? ' is-on' : ''}`} onClick={() => open(d)}>
            <span>{d.name}</span>
            {d.kind === 'menu' && active === `${ASSET_PREFIX}${d.id}` && <small className="axp-ctxd-muted"> · in use</small>}
          </button>
        </li>
      ))}
      {!list.length && <li className="axp-ctxd-muted">None yet.</li>}
    </ul>
  );

  return (
    <div className="axp-ctxd">
      <aside className="axp-ctxd-side fx-stack">
        {loadError() && <Note tone="danger">{loadError()}</Note>}
        <Container title="Menus" icon="list" actions={<Button size="sm" icon="plus" onClick={() => create('menu')}>New</Button>}><ListRows list={menus} /></Container>
        <Container title="Chunks" icon="layers" actions={<Button size="sm" icon="plus" onClick={() => create('chunk')}>New</Button>}>
          <p className="axp-ctxd-muted">Pieces you insert into menus by name. A chunk can hold items, separators and other chunks.</p>
          <ListRows list={chunks} />
        </Container>
      </aside>

      <main className="axp-ctxd-main fx-stack">
        {!draft && <Note>Pick a menu or chunk on the left, or make a new one.</Note>}
        {draft && (
          <>
            <Container title={draft.kind === 'menu' ? 'Menu' : 'Chunk'} icon={draft.kind === 'menu' ? 'list' : 'layers'} actions={dirty ? <small className="axp-ctxd-muted">Unsaved changes</small> : null}>
              <div className="axp-ctxd-grid">
                <TextField label="Name" value={draft.name} onChange={(v) => change({ name: v })} hint={saved && saved.name !== draft.name ? `Renames “${saved.name}” when you save.` : undefined} />
                {draft.kind === 'menu' && <SelectField label="Keep other targets from" value={draft.base} empty="None" options={bases.map((b) => ({ value: b.id, label: b.name }))} onChange={(v) => change({ base: v })} hint="Your menu replaces the default target; other targets (rows, cards…) come from this menu." />}
              </div>
              {draft.kind === 'menu' && (
                <div className="fx-row fx-row--wrap axp-ctxd-opts">
                  <Segmented label="Look" value={draft.variant} options={VARIANTS.map((v) => ({ value: v, label: v }))} onChange={(v) => change({ variant: v })} />
                  <Switch label="Icons" checked={draft.showIcons} onChange={(v) => change({ showIcons: v })} />
                  <Switch label="Shortcuts" checked={draft.showShortcuts} onChange={(v) => change({ showShortcuts: v })} />
                </div>
              )}
              {errors.length > 0 && <Note tone="warning">{errors.join(' ')}</Note>}
              <div className="fx-row fx-row--wrap axp-ctxd-opts">
                <Button tone="primary" icon="save" disabled={busy || errors.length > 0} onClick={() => void save()}>Save</Button>
                {draft.kind === 'menu' && saved && <Button icon="check" disabled={busy || dirty || active === assetId} onClick={use}>{active === assetId ? 'In use' : 'Use as the context menu'}</Button>}
                <Button icon="copy" onClick={duplicate}>Duplicate</Button>
                <Button icon="eye" onClick={() => setPreview((p) => !p)}>{preview ? 'Hide preview' : 'Show preview'}</Button>
                {!confirmDel
                  ? <Button tone="danger" icon="trash" disabled={busy} onClick={() => setConfirmDel(true)}>Delete</Button>
                  : <Button tone="danger" icon="trash" disabled={busy} onClick={() => void remove()}>Tap again to delete</Button>}
              </div>
              {draft.kind === 'chunk' && saved && usedBy(draft.id, all).length > 0 && <p className="axp-ctxd-muted">Used in: {usedBy(draft.id, all).map((d) => d.name).join(', ')}</p>}
              <div className="fx-row fx-row--wrap axp-ctxd-opts">
                <TextField label="Save as chunk" value={saveAsName} placeholder="Chunk name" onChange={setSaveAsName} />
                <Button icon="layers" disabled={busy || !saveAsName.trim()} onClick={() => void saveAsChunk()}>Save as chunk</Button>
              </div>
            </Container>

            <Container title="Style" icon="palette" collapsible>
              {draft.kind === 'chunk' && <Switch label="Inherit the menu’s style" checked={draft.inherit} onChange={(v) => change({ inherit: v })} hint={draft.inherit ? 'Draws like the menu it is inserted into. Its own settings below are kept for when you switch this off.' : 'Uses its own settings; anything left unset comes from the menu.'} />}
              <StyleEditor style={draft.style} disabled={draft.kind === 'chunk' && draft.inherit} onChange={(style) => change({ style })} />
            </Container>

            <Container title="Entries" icon="list">
              <div className="fx-row fx-row--wrap axp-ctxd-opts">
                <Button size="sm" icon="plus" onClick={() => add({ kind: 'item', label: 'New item' })}>Item</Button>
                <Button size="sm" icon="minus" onClick={() => add({ kind: 'separator' })}>Separator</Button>
                {selEntry?.kind === 'item' && <Button size="sm" icon="chevron-right" disabled={(sel?.length ?? 0) >= 4} onClick={() => add({ kind: 'item', label: 'New item' }, true)}>Item inside</Button>}
                {sel && <IconButton icon="chevron-up" label="Move up" onClick={() => { setItems(moveAt(draft.items, sel, -1)); setSel([...sel.slice(0, -1), Math.max(0, (sel.at(-1) ?? 0) - 1)]); }} />}
                {sel && <IconButton icon="chevron-down" label="Move down" onClick={() => { const n = (sel.length > 1 ? (getAt(draft.items, sel.slice(0, -1)) as Extract<Entry, { kind: 'item' }>).items?.length ?? 0 : draft.items.length); setItems(moveAt(draft.items, sel, 1)); setSel([...sel.slice(0, -1), Math.min(n - 1, (sel.at(-1) ?? 0) + 1)]); }} />}
                {sel && <IconButton icon="trash" label="Remove" onClick={() => { setItems(removeAt(draft.items, sel)); setSel(null); }} />}
              </div>
              <div className="fx-row fx-row--wrap axp-ctxd-opts">
                <label className="axp-ctxd-chunkpick">
                  <span className="axp-ctxd-muted">Insert a chunk by name</span>
                  <input className="fx-input" list="axp-ctxd-chunks" value={chunkName} placeholder="Chunk name" onChange={(e) => setChunkName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') insertChunk(); }} />
                  <datalist id="axp-ctxd-chunks">{chunks.filter((c) => c.id !== draft.id).map((c) => <option key={c.id} value={c.name} />)}</datalist>
                </label>
                <Button size="sm" icon="layers" disabled={!chunkName.trim()} onClick={insertChunk}>Insert chunk</Button>
              </div>
              {draft.items.length ? <EntryRows entries={draft.items} path={[]} selected={sel} onSelect={setSel} all={peers} /> : <p className="axp-ctxd-muted">Empty. Add an item, a separator or a chunk.</p>}
              {selEntry && <div className="axp-ctxd-edit"><EntryEditor entry={selEntry} all={peers} onChange={(patch) => sel && setItems(updateAt(draft.items, sel, patch))} /></div>}
              {compiled && compiled.errors.length > 0 && <Note tone="warning">{compiled.errors.join(' ')}</Note>}
            </Container>
            {preview && <Preview draft={draft} all={all} onClose={() => setPreview(false)} />}
          </>
        )}
      </main>
    </div>
  );
}
