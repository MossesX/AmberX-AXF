/**
 * Skin Builder (skin-sections@1, build skins-as-packages-of-slices, Nov 10 2026). Brett: "Drag one from the list into a
 * template that has all the categories a pack needs, build an entire skin, export it as a new skin, apply it."
 *
 * Left: the slice library — every section asset the console has (built-in and saved), searchable, by section, with a
 * live hover preview. Right: the pack template, one slot per section; drop a slice in (lib-dnd), or tap a slot's Pick
 * and tap a slice (phones). The whole console previews live through the runtime (`rt.previewSections`); Before / After
 * switches the preview off and on. Empty slots are highlighted; swap or clear any slot; save the current section of a
 * slot as an asset of its own. Save, Apply, Export (skin-package@1 file), Import, Duplicate, Load to edit later.
 * Everything here is also an API: the server routes (REST, MCP, CLI by plugin-commands@1) do the same without the UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, SelectField, Switch, TextField, useAxfState, useIsPhone, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { SKIN_SECTIONS, slug, type SkinSectionId, type SkinSections, type SliceEntry } from '@console/axf/core/engines/skin';
import { DragLayer, registerZone, startDrag, useDrag } from '@console/axf/libs/dnd';
import { FOLDER } from './api';

export const SKIN_BUILDER_VIEW = 'skin-builder';
const ZONE = 'skin-slot';
const KIND = 'skin-slice';
const DRAFT_KEY = 'axf.skin-builder.draft';
/** The skin the open action asked to edit (read once on mount). */
export const LOAD_KEY = 'axf.skin-builder.load';

interface Draft { id: string; name: string; description: string; sections: SkinSections; from: string }
const emptyDraft = (): Draft => ({ id: '', name: '', description: '', sections: {}, from: '' });
const readDraft = (): Draft => { try { const v = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); return v && typeof v === 'object' ? { ...emptyDraft(), ...v } : emptyDraft(); } catch { return emptyDraft(); } };

/** Swatches of a colour theme (bg, surface, accent, text) for a card. */
function swatchesOf(rt: AxfRuntime, id: string): string[] {
  const t = (rt.registry.get('color-theme', id)?.data as { tokens?: Record<string, string> } | undefined)?.tokens;
  return t ? [t.bg, t.surface, t.accent, t.text].filter((c): c is string => typeof c === 'string') : [];
}

function SliceCard({ entry, inSlot, onPick, onHover, draggable }: { entry: SliceEntry; inSlot: boolean; onPick: () => void; onHover: (on: boolean) => void; draggable: boolean }) {
  const sec = SKIN_SECTIONS.find((s) => s.id === entry.section)!;
  return (
    <div
      className={`axp-skin-builder__card${inSlot ? ' is-in-slot' : ''}`}
      role="option"
      aria-selected={inSlot}
      tabIndex={0}
      data-axf-slice={`${entry.section}/${entry.id}`}
      title={`${entry.description || entry.name}${entry.usedBy.length ? ` · used by ${entry.usedBy.join(', ')}` : ''}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
      onPointerDown={(e) => { if (draggable) startDrag(e, { kind: KIND, id: entry.id, label: entry.name, icon: sec.icon, data: { section: entry.section } }); }}
    >
      <span className="axp-skin-builder__grip axf-dnd-grip" aria-hidden="true"><Icon name="grip" size={12} /></span>
      <span className="axp-skin-builder__card-body">
        <span className="axp-skin-builder__card-head"><Icon name={sec.icon} size={13} /><span className="axp-skin-builder__card-name">{entry.name}</span>{entry.source !== 'builtin' && <span className="fx-chip">saved</span>}</span>
        {entry.preview.swatches?.length ? <span className="axp-skin-builder__swatches" aria-hidden="true">{entry.preview.swatches.map((c, i) => <span key={i} style={{ background: c }} />)}</span> : null}
        {entry.preview.facts?.length ? <span className="fx-muted axp-skin-builder__facts">{entry.preview.facts.join(' · ')}</span> : null}
        {!!entry.usedBy.length && <span className="fx-muted axp-skin-builder__facts">in {entry.usedBy.slice(0, 3).join(', ')}{entry.usedBy.length > 3 ? ` +${entry.usedBy.length - 3}` : ''}</span>}
      </span>
      {inSlot && <Icon name="check" size={14} className="axp-skin-builder__card-check" />}
    </div>
  );
}

export function SkinBuilder({ load }: { load?: string } = {}) {
  const rt = useRuntime();
  const st = useAxfState();
  const phone = useIsPhone();
  const drag = useDrag();
  const [draft, setDraft] = useState<Draft>(() => readDraft());
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('');
  const [pickFor, setPickFor] = useState<SkinSectionId | null>(null);
  const [after, setAfter] = useState(true);
  const [hover, setHover] = useState<{ section: SkinSectionId; id: string } | null>(null);
  const [snapped, setSnapped] = useState<string>('');
  const [saveSlot, setSaveSlot] = useState<{ section: SkinSectionId; name: string } | null>(null);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const library = useMemo(() => rt.sliceLibrary(), [rt, st.swaps]);
  const skins = rt.skinList();
  const current = rt.currentSkinSections();

  useEffect(() => { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }, [draft]);

  const loadSkin = useCallback((id: string) => {
    const info = rt.skinSectionsOf(id);
    const entry = rt.skinList().find((s) => s.id === id);
    if (!info || !entry) return;
    setDraft({ id, name: entry.name, description: entry.description, sections: { ...info.sections }, from: id });
    setNote(Object.keys(info.inline).length ? `${entry.name} still carries ${Object.keys(info.inline).join(' and ')} inline: use "Save as asset" on that slot to make it a slice.` : '');
  }, [rt]);
  // `load` (a prop) or the id the theme-manager.skin-builder:<skin> action left behind: load that skin to edit it
  useEffect(() => {
    const id = load || localStorage.getItem(LOAD_KEY) || '';
    localStorage.removeItem(LOAD_KEY);
    if (id) loadSkin(id);
  }, [load, loadSkin]);

  // the sections the console previews: the draft over what is in force now (so a half-built pack still shows); keyed by
  // value, so a render never redraws the same pack
  const currentKey = JSON.stringify(current.sections);
  const effectiveKey = useMemo(() => JSON.stringify({ ...(JSON.parse(currentKey) as SkinSections), ...draft.sections, ...(hover ? { [hover.section]: hover.id } : {}) }), [currentKey, draft.sections, hover]);
  useEffect(() => {
    if (!after) { rt.previewSections(null); return; }
    const effective = JSON.parse(effectiveKey) as SkinSections;
    if (effective.colors && effective.design && effective.layout) rt.previewSections(effective);
  }, [rt, after, effectiveKey]);
  useEffect(() => () => { rt.previewSections(null); }, [rt]);

  const setSlot = useCallback((section: SkinSectionId, id: string | null) => {
    setDraft((d) => { const sections = { ...d.sections }; if (id) sections[section] = id; else delete sections[section]; return { ...d, sections }; });
    if (id) { setSnapped(section); setTimeout(() => setSnapped(''), 450); }
    setPickFor(null);
    setHover(null);
  }, []);

  useEffect(() => registerZone(ZONE, {
    accepts: (p, target) => p.kind === KIND && (p.data as { section: string }).section === target,
    positions: () => ['inside'],
    drop: (p, target) => setSlot(target as SkinSectionId, p.id),
  }), [setSlot]);

  const filtered = library.filter((e) => (!pickFor || e.section === pickFor) && (!category || e.section === category) && (!q || `${e.id} ${e.name} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const grouped = SKIN_SECTIONS.map((sec) => ({ sec, items: filtered.filter((e) => e.section === sec.id) })).filter((g) => g.items.length);
  const missing = SKIN_SECTIONS.filter((s) => s.required && !draft.sections[s.id]);
  const filled = SKIN_SECTIONS.filter((s) => draft.sections[s.id]).length;
  const nameOf = (type: string, id: string) => rt.registry.get(type as never, id)?.name ?? id;
  const id = draft.id || slug(draft.name || 'my-skin');

  const save = (): string | null => {
    if (missing.length) { rt.toast(`A skin needs ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`, 'warning', 'Skin Builder'); return null; }
    if (!draft.name.trim()) { rt.toast('Give the skin a name.', 'warning', 'Skin Builder'); return null; }
    const a = rt.saveSkinFromSections({ id, name: draft.name.trim(), description: draft.description.trim(), tags: ['skin', 'custom'] }, draft.sections);
    if (!a) return null;
    setDraft((d) => ({ ...d, id, from: id }));
    return id;
  };
  const exportFile = () => {
    const sid = draft.from && JSON.stringify(rt.skinSectionsOf(draft.from)?.sections) === JSON.stringify(draft.sections) ? draft.from : save();
    if (!sid) return;
    const pkg = rt.exportSkinPackage(sid);
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${sid}.skin.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    rt.toast(`${sid}.skin.json: the skin with its ${pkg.sections.length} section assets inside.`, 'success', 'Exported');
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = rt.importSkinPackage(JSON.parse(await f.text()));
      if (!r.ok) { rt.toast(r.errors.join(' '), 'danger', 'Import'); return; }
      rt.toast(`${r.id} imported with its sections.`, 'success', 'Import');
      if (r.id) loadSkin(r.id);
    } catch (e) { rt.toast(`Not a skin package: ${(e as Error).message}`, 'danger', 'Import'); }
  };
  const saveSlotAsset = async () => {
    if (!saveSlot) return;
    const cap = rt.captureSection(saveSlot.section);
    const sec = SKIN_SECTIONS.find((s) => s.id === saveSlot.section)!;
    if (!cap) { rt.toast(`Nothing to save for ${sec.label.toLowerCase()} right now.`, 'warning', 'Skin Builder'); return; }
    const sid = slug(saveSlot.name);
    const asset = { $axf: 'asset@1', type: cap.type, id: sid, name: saveSlot.name.trim(), version: '1.0.0', description: `${sec.label} saved from the Skin Builder${cap.from ? ` (from ${cap.from})` : ''}.`, author: 'skin-builder', tags: [sec.id, 'custom'], data: cap.data };
    const r = rt.saveAsset(asset);
    if (!r.ok) { rt.toast(r.errors.join(' '), 'danger', 'Skin Builder'); return; }
    setSlot(saveSlot.section, sid);
    setSaveSlot(null);
    rt.toast(`${saveSlot.name} saved as a ${sec.label.toLowerCase()} asset${r.kept ? '' : ' (this session only)'}.`, 'success', 'Skin Builder');
  };

  const libraryPane = (
    <section className="axp-skin-builder__library" aria-label="Slice library">
      <div className="axp-skin-builder__libhead">
        <TextField label="Search slices" value={q} onChange={setQ} placeholder={pickFor ? `Pick ${SKIN_SECTIONS.find((s) => s.id === pickFor)?.label.toLowerCase()}…` : 'Search slices'} className="axp-skin-builder__search" />
        {!pickFor && <SelectField label="Section" value={category} onChange={setCategory} options={[{ value: '', label: 'Every section' }, ...SKIN_SECTIONS.map((s) => ({ value: s.id, label: s.label }))]} className="axp-skin-builder__filter" />}
        {pickFor && <Button size="sm" tone="quiet" icon="x" onClick={() => setPickFor(null)}>Done</Button>}
      </div>
      <p className="fx-muted axp-skin-builder__hint">{phone ? 'Tap a slot\'s Pick, then tap a slice.' : 'Drag a slice into its slot, or tap one. Hover shows it on the whole console.'}</p>
      <div className="axp-skin-builder__list" role="listbox" aria-label="Slices">
        {grouped.map(({ sec, items }) => (
          <div key={sec.id} className="axp-skin-builder__group">
            <p className="fx-eyebrow axp-skin-builder__group-head"><Icon name={sec.icon} size={12} /> {sec.label} <span className="fx-muted">{items.length}</span></p>
            <div className="axp-skin-builder__cards">
              {items.map((e) => <SliceCard key={`${e.section}/${e.id}`} entry={e} inSlot={draft.sections[e.section] === e.id} draggable={!phone} onPick={() => setSlot(e.section, e.id)} onHover={(on) => setHover(on ? { section: e.section, id: e.id } : null)} />)}
            </div>
          </div>
        ))}
        {!grouped.length && <p className="fx-muted">No slices match.</p>}
      </div>
    </section>
  );

  const template = (
    <section className="axp-skin-builder__pack" aria-label="Pack template">
      <div className="axp-skin-builder__packhead">
        <span className="fx-eyebrow">Pack template</span>
        <span className="fx-muted">{filled} of {SKIN_SECTIONS.length} slots · {missing.length ? `needs ${missing.map((m) => m.label.toLowerCase()).join(', ')}` : 'complete'}</span>
      </div>
      <div className="axp-skin-builder__slots">
        {SKIN_SECTIONS.map((sec) => {
          const sid = draft.sections[sec.id];
          const over = !!drag.payload && drag.payload.kind === KIND && (drag.payload.data as { section?: string } | undefined)?.section === sec.id;
          return (
            <div key={sec.id} className={`axp-skin-builder__slot${sid ? ' is-filled' : ' is-empty'}${sec.required ? ' is-required' : ''}${over ? ' is-target' : ''}${snapped === sec.id ? ' is-snapped' : ''}${pickFor === sec.id ? ' is-picking' : ''}`} data-axf-drop={ZONE} data-axf-drop-id={sec.id} data-axf-skin-slot={sec.id}>
              <div className="axp-skin-builder__slot-head"><Icon name={sec.icon} size={14} /><span className="axp-skin-builder__slot-label">{sec.label}</span>{sec.required && !sid && <span className="fx-chip">required</span>}</div>
              {sid ? (
                <div className="axp-skin-builder__slot-body">
                  {sec.id === 'colors' && <span className="axp-skin-builder__swatches" aria-hidden="true">{swatchesOf(rt, sid).map((c, i) => <span key={i} style={{ background: c }} />)}</span>}
                  <span className="axp-skin-builder__slot-name" title={sid}>{nameOf(sec.type, sid)}</span>
                </div>
              ) : <p className="fx-muted axp-skin-builder__slot-empty">{over ? `Drop to set ${sec.label.toLowerCase()}` : `Empty — ${sec.what}`}</p>}
              <div className="axp-skin-builder__slot-actions" role="toolbar" aria-label={`${sec.label} slot`}>
                <Button size="sm" tone="quiet" icon="search" onClick={() => { setPickFor(sec.id); setCategory(''); }}>{sid ? 'Swap' : 'Pick'}</Button>
                {sid && <Button size="sm" tone="quiet" icon="x" onClick={() => setSlot(sec.id, null)}>Clear</Button>}
                <Button size="sm" tone="quiet" icon="save" title={`Save the current ${sec.label.toLowerCase()} as an asset of its own`} onClick={() => setSaveSlot({ section: sec.id, name: `My ${sec.label.toLowerCase()}` })}>Save as asset…</Button>
              </div>
              {saveSlot?.section === sec.id && (
                <div className="axp-skin-builder__slot-save">
                  <TextField label="Asset name" value={saveSlot.name} onChange={(v) => setSaveSlot({ section: sec.id, name: v })} autoFocus />
                  <Button size="sm" tone="primary" onClick={() => void saveSlotAsset()}>Save</Button>
                  <Button size="sm" tone="quiet" onClick={() => setSaveSlot(null)}>Cancel</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="axp-skin-builder" data-axf-skin-builder="">
      <div className="axp-skin-builder__bar" role="toolbar" aria-label="Skin builder">
        <TextField label="Skin name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v, id: d.from ? d.id : slug(v) }))} placeholder="My skin" className="axp-skin-builder__name" />
        <TextField label="Description" value={draft.description} onChange={(v) => setDraft((d) => ({ ...d, description: v }))} placeholder="What this look is for" className="axp-skin-builder__desc" />
        <SelectField label="Load" value={draft.from} onChange={(v) => { if (v) loadSkin(v); }} options={[{ value: '', label: 'Load a skin to edit…' }, ...skins.map((s) => ({ value: s.id, label: `${s.name}${s.kind === 'design-package' ? ' (design package)' : ''}` }))]} className="axp-skin-builder__load" />
        <Switch label="After" hint="" checked={after} onChange={setAfter} title="On = the console shows this pack (after); off = the saved look (before)" />
        <Button size="sm" icon="plus" tone="quiet" onClick={() => { setDraft(emptyDraft()); setNote(''); }}>New</Button>
        <Button size="sm" icon="copy" tone="quiet" disabled={!draft.from} onClick={() => setDraft((d) => ({ ...d, id: `${d.id || slug(d.name)}-copy`, name: `${d.name} copy`, from: '' }))}>Duplicate</Button>
        <Button size="sm" icon="save" disabled={!!missing.length || !draft.name.trim()} onClick={() => { if (save()) rt.toast(`${draft.name} saved.`, 'success', 'Skin Builder'); }}>Save</Button>
        <Button size="sm" icon="check" tone="primary" disabled={!!missing.length || !draft.name.trim()} onClick={() => { const sid = save(); if (sid && rt.useSkin(true, sid)) rt.toast(`${draft.name} applied to this app.`, 'success', 'Skin Builder'); }}>Apply</Button>
        <Button size="sm" icon="download" tone="quiet" disabled={!!missing.length || !draft.name.trim()} onClick={exportFile}>Export</Button>
        <Button size="sm" icon="upload" tone="quiet" onClick={() => fileRef.current?.click()}>Import</Button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {!!note && <p className="fx-muted axp-skin-builder__note">{note}</p>}
      <div className={`axp-skin-builder__main${phone ? ' is-phone' : ''}`}>
        {phone ? (pickFor ? libraryPane : template) : <>{libraryPane}{template}</>}
      </div>
      <p className="fx-muted axp-skin-builder__api">Also an API: <code>GET /api/plugins/{FOLDER}/skins/sections</code>, <code>POST …/skins/build</code>, <code>…/skins/sections</code>, <code>GET …/skins/export/&lt;skin&gt;</code>, <code>POST …/skins/import</code>, <code>POST …/skins/&lt;app&gt;/use</code> with include / exclude; the same as MCP tools and <code>node framework/cli/skins.mjs</code>.</p>
      <DragLayer />
    </div>
  );
}
