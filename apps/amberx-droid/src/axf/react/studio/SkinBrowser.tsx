/**
 * Skins in the asset store (core/skin-library.ts): the skin browser (a grid of every skin with a live thumbnail drawn
 * from its own colour, layout and style themes; search and filter; apply here or hub-wide; favourite, duplicate,
 * delete, import, export) and the skin editor (look, layout, behaviour and colour theme plus every other slot a skin
 * fills, shown live on the app itself while you edit; save as new or overwrite).
 *
 * Reached from Assets → Skins, Settings → Appearance ("Browse skins") and the skins.* actions (console_action, MCP,
 * voice, the command palette); the editor and import are dialogs (console_open dialog axf.skin.editor / axf.skin.import).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { compileLayout, skinAsset, freeSkinId, SKIN_DRAFT_ID, SKIN_EDITOR_DIALOG, SKIN_IMPORT_DIALOG, type Asset, type AssetType, type LibraryEntry, type LibraryShow, type SkinData } from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, Chip, Segmented } from '../components/Controls';
import { Note, SelectField, TextField } from '../components/Forms';
import { Icon } from '../components/Icon';
import type { DialogMap } from '../components/Overlays';

const THEME_SLOTS = ['layout', 'color-theme', 'style-theme'];

function useLibrary() {
  const rt = useRuntime();
  useAxfState();
  useSyncExternalStore(rt.skins.subscribe, rt.skins.revision, rt.skins.revision);
  return rt.skins;
}

/** A skin drawn small from its own themes: the layout's regions in the colour theme's colours, the style's display font. */
export function SkinThumb({ data }: { data: SkinData }) {
  const rt = useRuntime();
  const colour = rt.registry.get('color-theme', data.colorTheme) as Asset<'color-theme'> | undefined;
  const layout = rt.registry.get('layout', data.layoutTheme) as Asset<'layout'> | undefined;
  const style = rt.registry.get('style-theme', data.styleTheme) as Asset<'style-theme'> | undefined;
  const t = colour?.data.tokens;
  // the skin's own colours; a skin naming a colour theme this app lacks is drawn in the app's
  const vars = { '--sk-bg': t?.bg ?? 'var(--fx-surface2)', '--sk-surface': t?.surface ?? 'var(--fx-surface3)', '--sk-border': t?.border ?? 'var(--fx-border)', '--sk-accent': t?.accent ?? 'var(--fx-accent)', '--sk-accent-text': t?.accentText ?? 'var(--fx-accent-text)' } as CSSProperties;
  const l = layout?.data;
  const c = l ? compileLayout({ ...l, navWidth: l.navWidth > 120 ? 30 : 14, inspectorWidth: 34 }) : null;
  const grid: CSSProperties = c ? { gridTemplateAreas: c.areas, gridTemplateColumns: c.columns, gridTemplateRows: c.rows.replace('minmax(0, 1fr)', '1fr') } : {};
  return (
    <div className="fx-pv-screen axf-skinthumb" style={{ ...vars, ...grid }} aria-hidden="true">
      {(c?.regions ?? ['main']).map((r) => (
        <div key={r} className={`axf-skinthumb__${r}`} style={{ gridArea: r }}>
          {r === 'main' && <span className="axf-skinthumb__aa" style={{ fontFamily: style?.data.fontDisplay, fontWeight: style?.data.headingWeight, borderRadius: style?.data.radius.md }}>Aa</span>}
        </div>
      ))}
    </div>
  );
}

const SHOW: { value: LibraryShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'favourites', label: 'Favourites' },
  { value: 'custom', label: 'Mine' },
  { value: 'skins', label: 'Skins' },
  { value: 'packages', label: 'Design packages' },
];

/** The skin browser: Assets → Skins. */
export function SkinBrowser() {
  const rt = useRuntime();
  const lib = useLibrary();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<LibraryShow>('all');
  const list = lib.list({ q, show });
  const total = lib.entries().length;
  const here = rt.skinAt();
  const global = rt.globalSkin();
  const previewing = rt.previewedSkin();
  useEffect(() => () => { if (rt.previewedSkin() && rt.previewedSkin() !== SKIN_DRAFT_ID) rt.previewSkin(null); }, [rt]);

  return (
    <section className="fx-stack" aria-labelledby="axf-skins-title" data-axf-skin-browser="">
      <div className="fx-slot__head">
        <Icon name="palette" size={16} />
        <h2 id="axf-skins-title">Skins</h2>
        <span className="fx-muted">{total} skins. A skin is a whole look: layout, colours, style, behaviour and every other part. Preview shows it on this app without saving.</span>
      </div>
      <div className="fx-row fx-row--wrap axf-skins__bar" role="toolbar" aria-label="Skins">
        <TextField label="Search skins" type="search" value={q} onChange={setQ} placeholder="Name, tag, description" className="axf-skins__search" />
        <Segmented label="Show" size="sm" value={show} options={SHOW} onChange={setShow} />
        <span className="fx-grow" />
        <Button size="sm" icon="plus" requires="assets.import" onClick={() => rt.openDialog(SKIN_EDITOR_DIALOG, { from: here.id || '' })}>New skin</Button>
        <Button size="sm" icon="upload" requires="assets.import" onClick={() => rt.openDialog(SKIN_IMPORT_DIALOG, {})}>Import</Button>
        {previewing && <Button size="sm" tone="primary" icon="x" onClick={() => rt.previewSkin(null)}>Stop preview</Button>}
      </div>
      {!list.length && <Note>{total ? 'No skin matches. Clear the search or pick All.' : 'No skins in this app yet.'}</Note>}
      <div className="fx-slot__grid">
        {list.map((e) => <SkinCard key={e.id} e={e} inUse={here.id === e.id} hubWide={global?.id === e.id} previewing={previewing === e.id} />)}
      </div>
    </section>
  );
}

function SkinCard({ e, inUse, hubWide, previewing }: { e: LibraryEntry; inUse: boolean; hubWide: boolean; previewing: boolean }) {
  const rt = useRuntime();
  const lib = rt.skins;
  const overrides = inUse ? [] : rt.skinOverrides();
  const askOverrides = overrides.length ? `This app overrides ${overrides.length} part${overrides.length > 1 ? 's' : ''} of its current skin (${overrides.join(', ')}). Applying ${e.name} drops those overrides. Apply?` : undefined;
  return (
    <article className={`fx-assetcard axf-skincard ${inUse ? 'is-active' : ''}`} aria-label={e.name}>
      <SkinThumb data={e.data} />
      <div className="fx-assetcard__meta">
        <div className="fx-assetcard__title">
          <strong>{e.name}</strong>
          <Button size="sm" tone={e.favourite ? 'primary' : 'quiet'} icon="star" aria-pressed={e.favourite} title={e.favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void lib.setFavourite(e.id, !e.favourite)}>{e.favourite ? 'Favourite' : ''}</Button>
        </div>
        <p>{e.data.preview?.caption || e.description}</p>
        <div className="fx-row fx-row--tight fx-row--wrap">
          <span className="fx-mono fx-muted">{e.id}</span>
          {e.kind === 'design-package' && <Chip>design package</Chip>}
          {e.custom && <Chip tone="accent">mine</Chip>}
          {inUse && <Chip tone="success">in this app</Chip>}
          {hubWide && <Chip tone="success">hub-wide</Chip>}
        </div>
        <div className="fx-row fx-row--tight fx-row--wrap" role="toolbar" aria-label={`${e.name} actions`}>
          <Button size="sm" tone={inUse ? 'quiet' : 'primary'} icon="check" requires="assets.swap" disabled={inUse} confirm={askOverrides} onClick={() => lib.apply(e.id)}>{inUse ? 'Applied' : 'Apply'}</Button>
          <Button size="sm" tone="quiet" icon="eye" requires="assets.swap" disabled={inUse} aria-pressed={previewing} onClick={() => rt.previewSkin(previewing ? null : e.id)}>{previewing ? 'Stop' : 'Preview'}</Button>
          <Button size="sm" tone="quiet" icon="cloud" requires="assets.swap" disabled={hubWide} title={lib.canSetGlobal() ? 'Every app that follows the hub-wide skin takes it' : 'Needs the skin store (theme manager); or: skins.mjs global <skin>'} onClick={() => void lib.applyEverywhere(e.id)}>Everywhere</Button>
          <Button size="sm" tone="quiet" icon="edit" requires="assets.import" onClick={() => rt.openDialog(SKIN_EDITOR_DIALOG, { id: e.id })}>Edit</Button>
          <Button size="sm" tone="quiet" icon="copy" requires="assets.import" onClick={() => void lib.duplicate(e.id)}>Duplicate</Button>
          <Button size="sm" tone="quiet" icon="download" onClick={() => lib.download(e.id)}>Export</Button>
          {e.custom && <Button size="sm" tone="danger" icon="trash" requires="assets.import" disabled={inUse} confirm={`Delete the skin ${e.name}? Export it first to keep a copy.`} onClick={() => void lib.remove(e.id)}>Delete</Button>}
        </div>
      </div>
    </article>
  );
}

/* ---------------- the skin editor (dialog) ---------------- */

type Draft = { name: string; description: string; data: SkinData };

function startDraft(rt: ReturnType<typeof useRuntime>, id?: string, from?: string): { draft: Draft; editing: string } {
  const src = (id && rt.skins.asSkinAsset(id)) || (from && rt.skins.asSkinAsset(from)) || null;
  if (src) return { draft: { name: id ? src.name : `${src.name} copy`, description: src.description ?? '', data: structuredClone(src.data) }, editing: id && rt.skins.isCustom(id) ? id : '' };
  const st = rt.getState().active as Record<string, string>;
  return { draft: { name: 'My skin', description: '', data: { layoutTheme: st.layout ?? '', colorTheme: st['color-theme'] ?? '', styleTheme: st['style-theme'] ?? '', assets: {} } }, editing: '' };
}

/** Edit a skin with the app as its live preview; Save as new or Overwrite (saved skins only). Closing puts the look back. */
export function SkinEditor({ id, from, close }: { id?: string; from?: string; close: () => void }) {
  const rt = useRuntime();
  const lib = useLibrary();
  const init = useMemo(() => startDraft(rt, id, from), [rt, id, from]);
  const [draft, setDraft] = useState<Draft>(init.draft);
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(true);
  const editing = init.editing;

  useEffect(() => { if (live) lib.previewDraft(draft.data, draft.name); else lib.previewDraft(null); }, [lib, draft, live]);
  useEffect(() => () => { lib.previewDraft(null); }, [lib]);
  // a look change underneath (the day / night colour switch, another tab) ends any preview: show the draft again
  const swaps = useAxfState().swaps;
  useEffect(() => { if (live && rt.previewedSkin() !== SKIN_DRAFT_ID) lib.previewDraft(draft.data, draft.name); }, [swaps]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts = (type: string) => rt.registry.list(type as AssetType).map((a) => ({ value: a.id, label: a.name }));
  const setTheme = (k: 'layoutTheme' | 'colorTheme' | 'styleTheme', v: string) => setDraft((d) => ({ ...d, data: { ...d.data, [k]: v } }));
  const setSlot = (t: string, v: string) => setDraft((d) => {
    const assets = { ...d.data.assets };
    if (v) assets[t] = v; else delete assets[t];
    return { ...d, data: { ...d.data, assets } };
  });
  const setIcons = (v: string) => setDraft((d) => { const data = { ...d.data }; if (v) data.iconPack = v; else delete data.iconPack; return { ...d, data }; });
  const slots = rt.skinCoverage().filter((r) => r.by === 'slot' && !THEME_SLOTS.includes(r.type) && r.type !== 'behavior-theme' && r.type !== 'icon-pack' && rt.registry.list(r.type as AssetType).length);

  const save = async (overwrite: boolean) => {
    setBusy(true);
    const newId = overwrite ? editing : freeSkinId(draft.name, lib.takenIds());
    const r = await lib.save(skinAsset(newId, draft.name, draft.data, { description: draft.description }), overwrite);
    setBusy(false);
    setErrors(r.errors);
    if (!r.ok) return;
    rt.toast(`${draft.name} ${overwrite ? 'saved' : 'saved as a new skin'}.`, 'success', 'Skins');
    close();
  };
  const saveApply = async () => {
    setBusy(true);
    const newId = editing || freeSkinId(draft.name, lib.takenIds());
    const r = await lib.save(skinAsset(newId, draft.name, draft.data, { description: draft.description }), !!editing);
    setBusy(false);
    setErrors(r.errors);
    if (r.ok) { lib.previewDraft(null); lib.apply(newId); close(); }
  };

  return (
    <form className="fx-stack" data-axf-skin-editor="" onSubmit={(ev) => { ev.preventDefault(); void save(!!editing); }}>
      <div className="axf-skineditor">
        <div className="fx-stack">
          <SkinThumb data={draft.data} />
          <Note>{live ? 'The app behind this dialog shows the skin as you edit. Nothing is saved until you save.' : 'Live preview is off: only the thumbnail changes.'}</Note>
          <Segmented label="Live preview" size="sm" value={live ? 'on' : 'off'} options={[{ value: 'on', label: 'Live on app' }, { value: 'off', label: 'Thumbnail only' }]} onChange={(v) => setLive(v === 'on')} />
        </div>
        <div className="fx-stack">
          <TextField label="Name" value={draft.name} required onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label="Description" rows={2} value={draft.description} onChange={(v) => setDraft((d) => ({ ...d, description: v }))} />
          <SelectField label="Look (style theme)" value={draft.data.styleTheme} options={opts('style-theme')} onChange={(v) => setTheme('styleTheme', v)} />
          <SelectField label="Colour theme" value={draft.data.colorTheme} options={opts('color-theme')} onChange={(v) => setTheme('colorTheme', v)} hint="The background and every colour come from here." />
          <SelectField label="Layout" value={draft.data.layoutTheme} options={opts('layout')} onChange={(v) => setTheme('layoutTheme', v)} />
          <SelectField label="Behaviour" value={draft.data.assets['behavior-theme'] ?? ''} empty="The app's own" options={opts('behavior-theme')} onChange={(v) => setSlot('behavior-theme', v)} />
          <SelectField label="Icon pack" value={draft.data.iconPack ?? ''} empty="The branding's" options={opts('icon-pack')} onChange={setIcons} />
          <Button size="sm" tone="quiet" icon={more ? 'chevron-up' : 'chevron-down'} aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? 'Fewer parts' : `Every other part (${slots.length})`}</Button>
          {more && (
            <div className="axf-skineditor__parts" role="group" aria-label="Parts this skin fills">
              {slots.map((r) => <SelectField key={r.type} label={r.label} value={draft.data.assets[r.type] ?? ''} empty="The app's own" options={opts(r.type)} onChange={(v) => setSlot(r.type, v)} />)}
            </div>
          )}
        </div>
      </div>
      {!!errors.length && <Note tone="danger">{errors.join(' · ')}</Note>}
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Skin editor">
        {editing && <Button tone="primary" icon="save" busy={busy} disabled={!draft.name.trim()} onClick={() => void save(true)}>Overwrite {editing}</Button>}
        <Button tone={editing ? 'neutral' : 'primary'} icon="plus" busy={busy} disabled={!draft.name.trim()} onClick={() => void save(false)}>Save as new</Button>
        <Button icon="check" busy={busy} requires="assets.swap" disabled={!draft.name.trim()} onClick={() => void saveApply()}>Save and apply</Button>
        <Button tone="quiet" onClick={close}>Cancel</Button>
      </div>
    </form>
  );
}

/** Import skin@1 JSON: paste it or pick files. Taken ids get a free one. */
function SkinImport({ close }: { close: () => void }) {
  const rt = useRuntime();
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = async (json: string) => {
    const r = await rt.skins.importJson(json);
    setErrors(r.errors);
    if (r.ok.length && !r.errors.length) close();
  };
  return (
    <div className="fx-stack" data-axf-skin-import="">
      <TextField label="Skin JSON" rows={8} mono value={text} onChange={setText} placeholder='{ "$axf": "asset@1", "type": "skin", … }' hint="One skin or a list. Exported skins (.skin.json) import as they are." />
      <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={(ev) => { for (const f of ev.target.files ?? []) void f.text().then(run); }} />
      {!!errors.length && <Note tone="danger">{errors.join(' · ')}</Note>}
      <div className="fx-row">
        <Button tone="primary" icon="upload" requires="assets.import" disabled={!text.trim()} onClick={() => void run(text)}>Import</Button>
        <Button icon="file" requires="assets.import" onClick={() => fileRef.current?.click()}>Choose files…</Button>
        <Button tone="quiet" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

export const skinDialogs: DialogMap = {
  [SKIN_EDITOR_DIALOG]: { title: 'Skin editor', icon: 'palette', render: (p, close) => <SkinEditor id={p.id as string | undefined} from={p.from as string | undefined} close={close} /> },
  [SKIN_IMPORT_DIALOG]: { title: 'Import skins', icon: 'upload', render: (_p, close) => <SkinImport close={close} /> },
};
