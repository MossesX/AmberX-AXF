/*
 * Theme editor: a Colour section and a Style section (each collapsible) with collapsible categories listing every
 * token, four views (tree, grid, swatches, compare), and copy / save / load of standard asset@1 themes. Edits are
 * drafts drawn in the preview card only (the theme engine's own variables, scoped to that card), so nothing reaches
 * other apps until you save: Save registers the theme and swaps to it, and the swap goes to the hub look (appearance@1),
 * so every app follows. The token tree is the Theme manager's (capability axf.token-tree@1, model.ts).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Button, Checkbox, Chip, ColorField, Container, Icon, IconButton, Note, Segmented, SelectField, Switch, TextField, useAxfState, useEditorSync, useRuntime } from '@console/axf/react';
import { assetTypeSpecs, colorThemeVars, styleThemeVars } from '@console/axf/core';
import type { ColorThemeData, StyleThemeData } from '@console/axf/core';
import { call, del, post, type SavedTheme } from './api';
import { SECTIONS, categories, diffPaths, filterCategories, parseThemes, slug, themeAsset, tokenTree, type Category, type Data, type Json, type SectionType, type Token, type TokenTree, type TypeSpec } from './model';

const P = 'axp-theme-editor';
export const VIEW_KEY = 'axf.theme-editor.view';
export const UNSET_KEY = 'axf.theme-editor.showUnset';
export type View = 'tree' | 'grid' | 'swatches' | 'compare';
export const VIEWS: { value: View; label: string; icon: string; title: string }[] = [
  { value: 'tree', label: 'Tree', icon: 'list', title: 'Sections and categories you fold open, one row per token' },
  { value: 'grid', label: 'Grid', icon: 'grid', title: 'Every token in one table: section, category, value' },
  { value: 'swatches', label: 'Swatches', icon: 'palette', title: 'Colours as swatches, style tokens as samples' },
  { value: 'compare', label: 'Compare', icon: 'layers', title: 'Your draft next to another theme, differences marked' },
];
const SPECS = assetTypeSpecs as unknown as Record<string, TypeSpec>;
const hidden = (id: string) => id.startsWith('tm-preview-') || id.startsWith('te-draft-');

interface Draft { from: string; fromName: string; data: Data; dirty: boolean }
type Drafts = Record<SectionType, Draft>;

/** The editor; needs the token tree service (Theme manager) and says so when it isn't there. */
export function ThemeEditor() {
  const tt = tokenTree();
  if (!tt) return <Note tone="warning"><strong>Needs the Theme manager.</strong> The Theme editor lists tokens with the Theme manager's token tree (axf.token-tree@1). Turn the Theme manager plugin on in Settings → Plugins, then come back.</Note>;
  return <Editor tt={tt} />;
}

function Editor({ tt }: { tt: TokenTree }) {
  const rt = useRuntime();
  const ax = useAxfState();
  const [view, setViewState] = useState<View>(() => (rt.settings.get(VIEW_KEY) as View) || 'tree');
  const setView = (v: View) => { setViewState(v); rt.settings.set(VIEW_KEY, v); };
  const showUnset = rt.settings.get(UNSET_KEY) !== false;
  const known = (t: SectionType) => rt.registry.list(t as never).filter((a) => !hidden(String(a.id))) as unknown as { id: string; name: string; data: Data }[];
  const activeDraft = (t: SectionType): Draft => { const a = rt.asset(t as never) as unknown as { id: string; name: string; data: Data }; return { from: a.id, fromName: a.name, data: structuredClone(a.data), dirty: false }; };
  const [drafts, setDrafts] = useState<Drafts>(() => ({ 'color-theme': activeDraft('color-theme'), 'style-theme': activeDraft('style-theme') }));
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState<SavedTheme[]>([]);
  const [busy, setBusy] = useState(false);

  // UI-editor rule: on open / focus, reload current values; a section you haven't touched follows the active theme.
  const follow = () => setDrafts((d) => ({ 'color-theme': d['color-theme'].dirty ? d['color-theme'] : activeDraft('color-theme'), 'style-theme': d['style-theme'].dirty ? d['style-theme'] : activeDraft('style-theme') }));
  useEditorSync({ onRefresh: () => { follow(); setViewState((rt.settings.get(VIEW_KEY) as View) || 'tree'); } });
  useEffect(follow, [ax.active['color-theme'], ax.active['style-theme']]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadSaved = () => call<{ items: SavedTheme[] }>('themes').then((r) => { setSaved(r.items); for (const a of r.items) rt.registry.register(a, 'imported', 'theme-editor'); }, () => setSaved([]));
  useEffect(() => { void loadSaved(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = useMemo(() => Object.fromEntries(SECTIONS.map((s) => [s.type, categories(tt, s.type, SPECS, drafts[s.type].data, known(s.type))])) as Record<SectionType, Category[]>, [tt, drafts, ax.active]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (t: SectionType) => filterCategories(cats[t], q).map((c) => ({ ...c, tokens: showUnset ? c.tokens : c.tokens.filter((x) => x.set) })).filter((c) => c.tokens.length);
  const edit = (t: SectionType, path: string, v: Json) => setDrafts((d) => ({ ...d, [t]: { ...d[t], data: tt.setAt(d[t].data, path, v), dirty: true } }));
  const value = (tk: Token) => tt.getAt(drafts[tk.type].data, tk.path);
  const dirty = SECTIONS.filter((s) => drafts[s.type].dirty).map((s) => s.type);
  const toggle = (id: string) => setClosed((c) => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  /* load / copy / save */
  const load = (t: SectionType, id: string) => {
    const a = rt.registry.get(t as never, id) as unknown as { id: string; name: string; data: Data } | undefined;
    if (a) setDrafts((d) => ({ ...d, [t]: { from: a.id, fromName: a.name, data: structuredClone(a.data), dirty: false } }));
  };
  const copyAsNew = () => {
    setDrafts((d) => ({ 'color-theme': { ...d['color-theme'], dirty: true }, 'style-theme': { ...d['style-theme'], dirty: true } }));
    setName(`${drafts['color-theme'].fromName} copy`);
    rt.toast('Copied into a new draft: name it and save', 'info', 'Theme editor');
  };
  const draftAssets = (types: SectionType[]) => types.map((t) => themeAsset(t, name || drafts[t].fromName, drafts[t].data, { id: name ? `${slug(name)}-${t === 'color-theme' ? 'colors' : 'style'}` : undefined, from: drafts[t].fromName }));
  const copyJson = async () => {
    const list = draftAssets(SECTIONS.map((s) => s.type));
    try { await navigator.clipboard.writeText(JSON.stringify(list, null, 2)); rt.toast('Both themes copied as asset@1 JSON', 'success', 'Theme editor'); }
    catch { rt.toast('The browser blocked the clipboard', 'warning', 'Theme editor'); }
  };
  const take = (list: ReturnType<typeof parseThemes>) => {
    for (const a of list) {
      const r = rt.registry.register(a as never, 'imported', 'theme-editor');
      if (!r.ok) { rt.toast(`${a.name}: not a valid ${a.type}`, 'danger', 'Theme editor'); continue; }
      load(a.type as SectionType, a.id);
    }
  };
  const paste = async () => {
    try { take(parseThemes(await navigator.clipboard.readText())); }
    catch (e) { rt.toast((e as Error).message, 'warning', 'Theme editor'); }
  };
  const importFile = async (f: File) => { try { take(parseThemes(await f.text())); } catch (e) { rt.toast((e as Error).message, 'danger', 'Theme editor'); } };
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true); setMsg('');
    try {
      for (const a of draftAssets(dirty.length ? dirty : SECTIONS.map((s) => s.type))) {
        const r = await post<{ asset: SavedTheme }>('themes', { asset: a });
        const reg = rt.registry.register(r.asset, 'imported', 'theme-editor');
        if (!reg.ok) throw new Error(`${a.type}: not a valid asset`);
        rt.swap(a.type as never, r.asset.id); // the hub look: every app follows
      }
      setName(''); void loadSaved();
      setDrafts({ 'color-theme': activeDraft('color-theme'), 'style-theme': activeDraft('style-theme') });
      rt.toast('Saved and applied', 'success', 'Theme editor');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const revert = () => { setDrafts({ 'color-theme': activeDraft('color-theme'), 'style-theme': activeDraft('style-theme') }); setMsg(''); };
  const removeSaved = async (a: SavedTheme) => {
    if ((ax.active as Record<string, string>)[a.type] === a.id) { rt.toast('Apply another theme first; this one is in use', 'warning', 'Theme editor'); return; }
    await del(`themes/${a.type}/${a.id}`); void loadSaved();
  };

  /* compare */
  const [other, setOther] = useState<Record<SectionType, string>>({ 'color-theme': '', 'style-theme': '' });
  const otherData = (t: SectionType): Data | null => { const a = other[t] && rt.registry.get(t as never, other[t]); return a ? (a as unknown as { data: Data }).data : null; };

  const previewStyle = useMemo(() => {
    try { return { ...colorThemeVars(drafts['color-theme'].data as unknown as ColorThemeData), ...styleThemeVars(drafts['style-theme'].data as unknown as StyleThemeData, rt.spacing()) } as CSSProperties; }
    catch { return {} as CSSProperties; }
  }, [drafts, rt]);

  const editor = (tk: Token) => <TokenValue key={tk.id} token={tk} value={value(tk)} onChange={(v) => edit(tk.type, tk.path, v)} />;

  return (
    <div className={`${P} fx-stack`}>
      <div className={`${P}__bar`} role="toolbar" aria-label="Theme editor">
        <Segmented label="View" size="sm" value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v.value, label: v.label, icon: v.icon, title: v.title }))} />
        <input className={`fx-input ${P}__search`} placeholder="Find a token" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a token" />
        <Button size="sm" icon="copy" title="Start a new theme from the one you're editing" onClick={copyAsNew}>Copy</Button>
        <IconButton icon="code" label="Copy both themes as asset@1 JSON" onClick={() => void copyJson()} />
        <IconButton icon="paste" label="Load themes from asset@1 JSON on the clipboard" onClick={() => void paste()} />
        <label className="fx-iconbtn" title="Load an asset@1 theme file"><Icon name="upload" size={13} /><input type="file" accept="application/json" hidden aria-label="Load a theme file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} /></label>
        <IconButton icon="undo" label="Back to the active themes" disabled={!dirty.length} onClick={revert} />
        <span className="fx-grow" />
        {dirty.length > 0 && <Chip tone="warning">unsaved: {dirty.map((t) => SECTIONS.find((s) => s.type === t)!.label.toLowerCase()).join(', ')}</Chip>}
      </div>

      <div className={`${P}__load`}>
        {SECTIONS.map((s) => (
          <SelectField key={s.type} label={`Load ${s.label.toLowerCase()} theme`} value={drafts[s.type].from} onChange={(id) => load(s.type, id)}
            options={known(s.type).map((a) => ({ value: a.id, label: `${a.name}${a.id === ax.active[s.type as never] ? ' (active)' : ''}` }))} />
        ))}
      </div>

      <form className={`${P}__save`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Icon name="save" size={14} />
        <input className="fx-input fx-grow" placeholder="Name this theme to save it" value={name} onChange={(e) => setName(e.target.value)} aria-label="Theme name" />
        <Button size="sm" tone="primary" icon="save" busy={busy} disabled={!name.trim()} title="Save as asset@1 themes and apply them in every app (hub look)" onClick={() => void save()}>Save &amp; apply</Button>
        {msg && <span className={`${P}__bad fx-small`}>{msg}</span>}
      </form>

      <div className={`${P}__main`}>
        <div className="fx-stack">
          {SECTIONS.map((s) => (
            <Container key={s.type} collapsible defaultOpen title={`${s.label} · ${drafts[s.type].fromName}${drafts[s.type].dirty ? ' (edited)' : ''}`} icon={s.icon}
              actions={<span className="fx-small fx-muted">{cats[s.type].reduce((n, c) => n + c.tokens.length, 0)} tokens</span>}>
              {view === 'tree' && <TreeView cats={shown(s.type)} closed={closed} toggle={toggle} editor={editor} />}
              {view === 'grid' && <GridView cats={shown(s.type)} editor={editor} />}
              {view === 'swatches' && <SwatchView cats={shown(s.type)} value={value} editor={editor} />}
              {view === 'compare' && (
                <CompareView tt={tt} type={s.type} cats={shown(s.type)} draft={drafts[s.type].data} other={otherData(s.type)} otherId={other[s.type]}
                  options={known(s.type).filter((a) => a.id !== drafts[s.type].from)} setOther={(id) => setOther((o) => ({ ...o, [s.type]: id }))}
                  take={(path, v) => edit(s.type, path, v)} />
              )}
            </Container>
          ))}
        </div>
        <aside className="fx-stack">
          <Container title="Preview (draft)" icon="eye">
            <div className={`${P}__preview`} style={previewStyle}>
              <strong>{name || 'Untitled theme'}</strong>
              <p className="fx-muted fx-small">Body text and muted text in the draft. Nothing outside this card changes until you save.</p>
              <div className={`${P}__bar`}><Button size="sm" tone="primary">Primary</Button><Button size="sm">Neutral</Button><Button size="sm" tone="ghost">Ghost</Button></div>
              <div className={`${P}__bar`}><Chip tone="success">success</Chip><Chip tone="warning">warning</Chip><Chip tone="danger">danger</Chip><Chip tone="accent">accent</Chip></div>
              <TextField label="A field" value="" placeholder="Type here" onChange={() => undefined} />
              <Switch label="A switch" checked onChange={() => undefined} />
            </div>
          </Container>
          <Container title="Saved in the editor" icon="save" collapsible defaultOpen>
            {!saved.length ? <p className="fx-small fx-muted">Nothing saved yet. Name a draft and tap Save &amp; apply.</p> : (
              <ul className={`${P}__saved`}>
                {saved.map((a) => (
                  <li key={`${a.type}/${a.id}`}>
                    <span className={`${P}__savedname`} title={`${a.type} · ${a.id}`}><strong>{a.name}</strong> <span className="fx-small fx-muted">{a.type === 'color-theme' ? 'colour' : 'style'}</span></span>
                    <Button size="sm" tone="ghost" icon="edit" onClick={() => load(a.type as SectionType, a.id)}>Load</Button>
                    <IconButton icon="trash" label={`Delete ${a.name}`} onClick={() => void removeSaved(a)} />
                  </li>
                ))}
              </ul>
            )}
          </Container>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- views ---------------- */

function TreeView({ cats, closed, toggle, editor }: { cats: Category[]; closed: Set<string>; toggle: (id: string) => void; editor: (t: Token) => JSX.Element }) {
  if (!cats.length) return <p className="fx-small fx-muted">No token matches.</p>;
  return (
    <ul className={`${P}__cats`}>
      {cats.map((c) => {
        const id = `${c.tokens[0]?.type}:${c.id}`;
        const open = !closed.has(id);
        return (
          <li key={id}>
            <button type="button" data-fx-row className={`${P}__cathead`} aria-expanded={open} onClick={() => toggle(id)}>
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} /><Icon name={c.icon} size={13} /><span className="fx-grow">{c.label}</span><span className="fx-small fx-muted">{c.tokens.length}</span>
            </button>
            {open && <div className={`${P}__rows`}>{c.tokens.map(editor)}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function GridView({ cats, editor }: { cats: Category[]; editor: (t: Token) => JSX.Element }) {
  return (
    <div className={`${P}__grid`} role="table" aria-label="Tokens">
      <div className={`${P}__gridhead`} role="row"><span role="columnheader">Category</span><span role="columnheader">Token</span></div>
      {cats.flatMap((c) => c.tokens.map((t) => (
        <div key={t.id} className={`${P}__gridrow`} role="row"><span role="cell" className="fx-small fx-muted">{c.label}</span><span role="cell">{editor(t)}</span></div>
      )))}
    </div>
  );
}

function SwatchView({ cats, value, editor }: { cats: Category[]; value: (t: Token) => Json | undefined; editor: (t: Token) => JSX.Element }) {
  const [pick, setPick] = useState<string | null>(null);
  const all = cats.flatMap((c) => c.tokens);
  const sel = all.find((t) => t.id === pick);
  const sample = (t: Token): CSSProperties => {
    const v = value(t);
    if (t.leaf.kind === 'color') return { background: String(v ?? '') };
    if (/^radius\./.test(t.path)) return { borderRadius: `${Number(v)}px` };
    if (/^shadow\./.test(t.path)) return { boxShadow: String(v ?? '') };
    if (/^font(Family|Display|Mono)$/.test(t.path)) return { fontFamily: String(v ?? '') };
    return {};
  };
  return (
    <div className="fx-stack">
      <div className={`${P}__swatches`}>
        {all.map((t) => (
          <button key={t.id} type="button" data-fx-row className={`${P}__swatch ${pick === t.id ? 'is-sel' : ''} ${t.set ? '' : 'is-unset'}`} title={`${t.label} · ${t.path}`} onClick={() => setPick(t.id)}>
            <span className={`${P}__chipbox ${t.leaf.kind === 'color' ? 'is-color' : ''}`} style={sample(t)} aria-hidden>{t.leaf.kind === 'color' ? '' : t.leaf.kind === 'number' || t.leaf.kind === 'enum' || t.leaf.kind === 'bool' ? String(value(t) ?? '') : 'Aa'}</span>
            <span className="fx-small">{t.label}</span>
          </button>
        ))}
      </div>
      {sel ? editor(sel) : <p className="fx-small fx-muted">Tap a swatch to edit it.</p>}
    </div>
  );
}

function CompareView({ tt, type, cats, draft, other, otherId, options, setOther, take }: {
  tt: TokenTree; type: SectionType; cats: Category[]; draft: Data; other: Data | null; otherId: string;
  options: { id: string; name: string }[]; setOther: (id: string) => void; take: (path: string, v: Json) => void;
}) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  const tokens = cats.flatMap((c) => c.tokens);
  const diffs = new Set(other ? diffPaths(tt, draft, other, tokens) : []);
  const rows = onlyDiff && other ? tokens.filter((t) => diffs.has(t.path)) : tokens;
  const show = (v: Json | undefined) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <div className="fx-stack">
      <div className={`${P}__bar`}>
        <SelectField label={`Compare with`} value={otherId} empty="Pick a theme…" onChange={setOther} options={options.map((a) => ({ value: a.id, label: a.name }))} />
        {other && <Checkbox label={`Only differences (${diffs.size})`} checked={onlyDiff} onChange={setOnlyDiff} />}
      </div>
      {!other ? <p className="fx-small fx-muted">Pick a {type === 'color-theme' ? 'colour' : 'style'} theme to see it next to your draft.</p> : (
        <div className={`${P}__cmp`} role="table" aria-label="Compare">
          <div className={`${P}__cmprow ${P}__gridhead`} role="row"><span role="columnheader">Token</span><span role="columnheader">Draft</span><span role="columnheader">Other</span><span /></div>
          {rows.map((t) => {
            const a = tt.getAt(draft, t.path), b = tt.getAt(other, t.path);
            const color = t.leaf.kind === 'color';
            return (
              <div key={t.id} className={`${P}__cmprow ${diffs.has(t.path) ? 'is-diff' : ''}`} role="row">
                <span role="cell">{t.label}</span>
                <span role="cell" className={`${P}__cmpval fx-mono fx-small`}>{color && <span className={`${P}__dot`} style={{ background: String(a ?? '') }} aria-hidden />}{show(a)}</span>
                <span role="cell" className={`${P}__cmpval fx-mono fx-small`}>{color && <span className={`${P}__dot`} style={{ background: String(b ?? '') }} aria-hidden />}{show(b)}</span>
                <span role="cell">{diffs.has(t.path) && b !== undefined && <Button size="sm" tone="ghost" icon="arrow-left" title="Take the other theme's value into the draft" onClick={() => take(t.path, b as Json)}>Take</Button>}</span>
              </div>
            );
          })}
          {!rows.length && <p className="fx-small fx-muted">No differences.</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------- one token's editor ---------------- */

function TokenValue({ token, value, onChange }: { token: Token; value: Json | undefined; onChange: (v: Json) => void }) {
  const f = token.leaf;
  const [v, setV] = useState<Json | undefined>(value);
  useEffect(() => setV(value), [value]);
  const label = <span className={`${P}__tlabel`} title={token.path}>{token.label}{!token.set && <span className="fx-small fx-muted"> · not set</span>}</span>;
  const hex = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined;
  return (
    <div className={`${P}__token`}>
      {f.kind === 'color' && <ColorField label={label} value={String(v ?? '')} swatch={hex} onChange={(x) => { setV(x); onChange(x); }} />}
      {f.kind === 'enum' && <SelectField label={label} value={String(v ?? '')} options={(f.enum ?? []).map((x) => ({ value: x, label: x }))} onChange={onChange} />}
      {f.kind === 'bool' && <Switch label={token.label} hint={token.set ? undefined : 'not set'} checked={!!v} onChange={onChange} />}
      {f.kind === 'number' && (
        <TextField label={label} mono value={v === undefined || v === null ? '' : String(v)} onChange={(x) => { setV(x); const n = Number(x); if (x.trim() !== '' && Number.isFinite(n)) onChange(n); }}
          hint={f.range && f.range[0] !== f.range[1] ? `Known themes use ${f.range[0]} to ${f.range[1]}` : undefined} />
      )}
      {f.kind === 'string' && (
        <>
          <TextField label={label} mono value={String(v ?? '')} onChange={(x) => { setV(x); onChange(x); }} />
          {!!f.values?.length && f.values.length > 1 && <SelectField label="Values other themes use" value="" empty="Pick one…" options={f.values.map((x) => ({ value: JSON.stringify(x), label: String(x).slice(0, 60) }))} onChange={(x) => x && onChange(JSON.parse(x) as Json)} />}
        </>
      )}
    </div>
  );
}
