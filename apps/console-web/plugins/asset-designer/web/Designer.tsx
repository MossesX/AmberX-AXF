import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssetPreview, Button, Chip, ColorField, Container, Note, SelectField, Switch, TabGroup, TextField, useEditorSync, useRuntime } from '@console/axf/react';
import { CHROME_FIELDS, CHROME_TYPES, assetTypeSpecs, chromeLabel, chromeSettingsDefaultId, isChromeType, validateAsset, type AssetEnvelope, type AssetType } from '@console/axf/core';
import { ORIGIN, call, del, post, type SavedAsset } from './api';
import { onIntent, takeIntent, type Intent } from './intent';
import { PREVIEW_PREFIX, chromeTypeOfSettings, defaultOf, fieldsFor, gate, newAsset, parseJson, previewable, starterFor, stripDesigned, suggestId, typeOptions, type ChromeFields, type Draft, type FieldDef, type Spec } from './model';

/*
 * The designer: one screen for every asset type. Pick a type, open a saved asset or start a new one (blank or from a
 * built-in), edit the envelope and every field the type registers (chrome fields, required, optional), or the whole
 * data as JSON; the validation gate runs on every change and names the field each problem is about; Save is off until
 * the asset is clean, and the server runs the framework validator again before it writes. Live preview swaps the real
 * chrome to the draft (restored when it is turned off). Chrome types get a button to their settings interface asset.
 */
export const TYPE_KEY = 'axf.asset-designer.type';
export const LIVE_KEY = 'axf.asset-designer.live';
type Tab = 'fields' | 'json' | 'preview' | 'manifest';
const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: 'fields', label: 'Fields', icon: 'sliders' }, { value: 'json', label: 'JSON', icon: 'code' },
  { value: 'preview', label: 'Preview', icon: 'eye' }, { value: 'manifest', label: 'Manifest', icon: 'file' },
];
const spec = assetTypeSpecs as unknown as Spec;
const chrome = CHROME_FIELDS as unknown as ChromeFields;
const chromeTypes = CHROME_TYPES as readonly string[];
const TYPE_OPTIONS = typeOptions(spec);
const pretty = (v: unknown) => JSON.stringify(v ?? null, null, 2);

export function Designer() {
  const rt = useRuntime();
  const [type, setTypeState] = useState<string>(() => { const t = rt.settings.get(TYPE_KEY); return typeof t === 'string' && spec[t] ? t : 'toolbar'; });
  const [asset, setAsset] = useState<Draft>(() => newAsset(type, '', '', starterFor(spec, chrome, type)));
  const [isNew, setIsNew] = useState(true);
  const [saved, setSaved] = useState<SavedAsset[]>([]);
  const [builtins, setBuiltins] = useState<SavedAsset[]>([]);
  const [tab, setTab] = useState<Tab>('fields');
  const [jsonText, setJsonText] = useState(() => pretty(asset.data));
  const [jsonError, setJsonError] = useState('');
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, { text: string; error: string }>>({});
  const [live, setLiveState] = useState(() => rt.settings.get(LIVE_KEY) === true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'info' | 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const prevActive = useRef<{ type: string; id: string } | null>(null);

  const sample = useMemo(() => builtins[0]?.data, [builtins]);
  const fields = useMemo(() => fieldsFor(spec, chrome, type, asset.data && Object.keys(asset.data).length ? asset.data : sample), [type, asset.data, sample]);
  const g = useMemo(() => gate(validateAsset, asset, fields), [asset, fields]);
  const savedOfType = useMemo(() => saved.filter((a) => a.type === type), [saved, type]);
  const chromeOf = chromeTypeOfSettings(asset, chromeTypes);

  const refreshSaved = useCallback(async () => {
    const r = await call<{ items: SavedAsset[] }>('assets').catch(() => null);
    if (r) setSaved(r.items);
  }, []);
  const loadBuiltins = useCallback(async (t: string) => {
    const r = await call<{ items: SavedAsset[] }>(`builtin/${encodeURIComponent(t)}`).catch(() => null);
    setBuiltins(r?.items ?? []);
  }, []);
  useEffect(() => { void refreshSaved(); }, [refreshSaved]);
  useEffect(() => { void loadBuiltins(type); }, [type, loadBuiltins]);
  useEditorSync({ onRefresh: () => { void refreshSaved(); } });

  /* ---- live preview: swap the real chrome to the draft, restore when it is off / the type changes / we leave ---- */
  const restore = useCallback(() => {
    const p = prevActive.current;
    if (p) { rt.swap(p.type as AssetType, p.id); prevActive.current = null; }
  }, [rt]);
  useEffect(() => {
    if (!live || !g.ok || !previewable(spec, type)) return;
    const pid = `${PREVIEW_PREFIX}${type}`.slice(0, 48);
    const r = rt.registry.register({ ...stripDesigned(asset), id: pid, name: `${asset.name || asset.id} (preview)` }, 'imported', ORIGIN);
    if (!r.ok) return;
    const active = (rt.getState().active as Record<string, string | undefined>)[type];
    if (active && active !== pid && !prevActive.current) prevActive.current = { type, id: active };
    rt.swap(type as AssetType, pid);
  }, [live, g.ok, asset, type, rt]);
  useEffect(() => { if (!live) return; return restore; }, [live, type, restore]);
  useEffect(() => restore, [restore]);
  const setLive = (v: boolean) => { setLiveState(v); rt.settings.set(LIVE_KEY, v); };

  /* ---- open / new / type ---- */
  const openDraft = useCallback((a: Draft, fresh: boolean) => {
    setAsset(a); setIsNew(fresh); setJsonText(pretty(a.data)); setJsonError(''); setJsonDrafts({}); setNote(null);
    if (a.type !== type) { setTypeState(a.type); rt.settings.set(TYPE_KEY, a.type); }
  }, [type, rt]);
  const startNew = useCallback((t: string, from?: Record<string, unknown>, name = '') => {
    const data = starterFor(spec, chrome, t, from);
    openDraft(newAsset(t, name ? suggestId(name, saved.filter((a) => a.type === t).map((a) => a.id)) : '', name, data), true);
  }, [openDraft, saved]);
  const setType = (t: string) => { if (!spec[t]) return; startNew(t); };
  const openSaved = (id: string) => { const a = saved.find((x) => x.type === type && x.id === id); if (a) openDraft(a as Draft, false); };
  const openChrome = useCallback(async (ct: string) => {
    if (!isChromeType(ct)) return;
    const base = chromeSettingsDefaultId(ct);
    const custom = `${base}-designed`;
    const mine = saved.find((a) => a.type === 'settings' && a.id === custom);
    if (mine) { openDraft(mine as Draft, false); return; }
    const r = await call<{ items: SavedAsset[] }>('builtin/settings').catch(() => null);
    const def = r?.items.find((a) => a.id === base);
    openDraft(newAsset('settings', custom, `${chromeLabel(ct)} settings (designed)`, starterFor(spec, chrome, 'settings', def?.data ?? { for: ct })), true);
    setNote({ tone: 'info', text: `This is a copy of the shared default settings interface of every ${chromeLabel(ct).toLowerCase()} (${base}); the default itself is never changed. Every token it has is a field here: layout, header, search, descriptions, tabs, hide, groups, levels, default level, level of each item, visible, toolbar, extends. Save it, then pick it under Settings → Appearance → Chrome settings.` });
  }, [saved, openDraft]);

  // deep links: the plugin's actions (console, MCP, CLI, voice) say what to open
  const applyIntent = useCallback((i: Intent) => {
    if (i.chrome) { void openChrome(i.chrome); return; }
    if (i.type && spec[i.type]) {
      if (i.id) { const a = saved.find((x) => x.type === i.type && x.id === i.id); if (a) { openDraft(a as Draft, false); return; } }
      startNew(i.type);
    }
  }, [openChrome, openDraft, startNew, saved]);
  const intentRef = useRef<Intent | null>(takeIntent());
  useEffect(() => {
    const i = intentRef.current;
    if (i && (!i.id || saved.length)) { intentRef.current = null; applyIntent(i); }
  }, [saved, applyIntent]);
  useEffect(() => onIntent((i) => { if (i.id && !saved.length) intentRef.current = i; else applyIntent(i); }), [applyIntent, saved.length]);

  /* ---- edits ---- */
  const patch = (p: Partial<Draft>) => setAsset((a) => ({ ...a, ...p }));
  const setData = (key: string, value: unknown) => setAsset((a) => { const data = { ...a.data }; if (value === undefined) delete data[key]; else data[key] = value; setJsonText(pretty(data)); return { ...a, data }; });
  const applyJson = () => {
    const r = parseJson(jsonText);
    if (r.error || typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) { setJsonError(r.error ?? 'data must be a JSON object'); return; }
    setJsonError(''); setJsonDrafts({}); patch({ data: r.value as Record<string, unknown> });
  };
  const setJsonField = (f: FieldDef, text: string) => {
    const r = parseJson(text);
    setJsonDrafts((d) => ({ ...d, [f.key]: { text, error: r.error ?? '' } }));
    if (!r.error) setData(f.key, r.value);
  };

  /* ---- server: save, duplicate, delete ---- */
  const save = async () => {
    if (!g.ok || busy) return;
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; asset: SavedAsset }>('assets', { asset, overwrite: true });
      rt.registry.register(r.asset, 'imported', ORIGIN);
      openDraft(r.asset as Draft, false);
      await refreshSaved();
      rt.toast(`${r.asset.name} saved (${r.asset.type}/${r.asset.id}, revision ${r.asset.designed?.revision ?? 1})`, 'success');
    } catch (e) {
      setNote({ tone: 'danger', text: `Not saved: ${(e as Error).message}` });
    } finally { setBusy(false); }
  };
  const duplicate = () => {
    const id = suggestId(`${asset.id || asset.name || 'asset'}-copy`, savedOfType.map((a) => a.id));
    openDraft({ ...stripDesigned(asset), id, name: `${asset.name || asset.id} copy` }, true);
  };
  const remove = async () => {
    if (isNew || busy) return;
    setBusy(true);
    try {
      await del(`assets/${encodeURIComponent(asset.type)}/${encodeURIComponent(asset.id)}`);
      rt.toast(`${asset.name} deleted`, 'info');
      await refreshSaved();
      startNew(type);
    } catch (e) {
      setNote({ tone: 'danger', text: `Not deleted: ${(e as Error).message}` });
    } finally { setBusy(false); }
  };
  const reload = async () => { await refreshSaved(); await loadBuiltins(type); rt.dispatch('asset-designer.reload'); };

  /* ---- render ---- */
  const groups: { id: FieldDef['group']; title: string }[] = [{ id: 'chrome', title: 'Chrome settings fields' }, { id: 'required', title: 'Required fields' }, { id: 'optional', title: 'Optional fields' }];
  const renderField = (f: FieldDef) => {
    const v = asset.data[f.key];
    const err = g.byField[f.key]?.join(' · ');
    const hint = f.hint || (f.required ? 'Required by the asset type.' : undefined);
    switch (f.kind) {
      case 'choice': return <SelectField key={f.key} label={f.label} value={String(v ?? defaultOf(f))} options={(f.options ?? []).map((o) => ({ value: o, label: f.labels?.[o] ?? o }))} onChange={(x) => setData(f.key, x)} hint={hint} error={err} />;
      case 'toggle': return <Switch key={f.key} label={f.label} checked={typeof v === 'boolean' ? v : Boolean(defaultOf(f))} onChange={(x) => setData(f.key, x)} hint={err ?? hint} />;
      case 'number': return <TextField key={f.key} label={f.label} type="number" value={v === undefined || v === null ? '' : String(v)} onChange={(x) => setData(f.key, x === '' ? undefined : Number(x))} hint={hint} error={err} />;
      case 'color': return <ColorField key={f.key} label={f.label} value={typeof v === 'string' ? v : ''} onChange={(x) => setData(f.key, x || undefined)} hint={hint} error={err} />;
      case 'json': {
        const d = jsonDrafts[f.key];
        return <div key={f.key} className="axp-asset-designer__json"><TextField label={f.label} mono rows={Math.min(14, Math.max(3, (d?.text ?? pretty(v ?? defaultOf(f))).split('\n').length))} value={d?.text ?? (v === undefined ? '' : pretty(v))} onChange={(x) => setJsonField(f, x)} hint={hint} error={d?.error ? `JSON: ${d.error}` : err} placeholder={f.object ? '{ }' : '[ ]'} /></div>;
      }
      default: return <TextField key={f.key} label={f.label} value={typeof v === 'string' ? v : v === undefined ? '' : String(v)} onChange={(x) => setData(f.key, x === '' && !f.required ? undefined : x)} hint={hint} error={err} />;
    }
  };

  return (
    <div className="axp-asset-designer">
      <div className="axp-asset-designer__bar" role="toolbar" aria-label="Asset designer">
        <SelectField label="Asset type" value={type} options={TYPE_OPTIONS} onChange={setType} />
        <SelectField label="Open" value={isNew ? '' : asset.id} options={[{ value: '', label: 'New asset…' }, ...savedOfType.map((a) => ({ value: a.id, label: `${a.name} (${a.id})` }))]} onChange={(id) => (id ? openSaved(id) : startNew(type))} />
        <SelectField label="Start from" value="" options={[{ value: '', label: builtins.length ? 'A built-in asset…' : 'No built-in assets of this type' }, ...builtins.map((b) => ({ value: b.id, label: `${b.name} (${b.id})` }))]} onChange={(id) => { const b = builtins.find((x) => x.id === id); if (b) startNew(type, b.data, `${b.name} copy`); }} />
        <div className="axp-asset-designer__actions">
          <Button size="sm" icon="plus" onClick={() => startNew(type)}>New</Button>
          <Button size="sm" icon="copy" onClick={duplicate} disabled={!asset.id}>Duplicate</Button>
          <Button size="sm" icon="refresh" onClick={() => void reload()}>Reload</Button>
          <Button size="sm" tone="danger" icon="trash" onClick={() => void remove()} disabled={isNew || busy} confirm={`Delete ${asset.name || asset.id}? Built-in assets are never touched.`}>Delete</Button>
          <Button size="sm" tone="primary" icon="save" onClick={() => void save()} disabled={!g.ok || busy}>Save</Button>
        </div>
      </div>

      <div className="axp-asset-designer__state">
        <Chip tone={g.ok ? 'success' : 'danger'}>{g.ok ? 'Valid' : `${g.errors.length} problem${g.errors.length === 1 ? '' : 's'}`}</Chip>
        <Chip>{isNew ? 'New' : `Saved · revision ${(asset.designed as { revision?: number } | undefined)?.revision ?? 1}`}</Chip>
        <Chip>{spec[type]?.label ?? type}</Chip>
        {previewable(spec, type) ? <Switch label="Live preview" checked={live} onChange={setLive} hint="Swaps the real chrome to this draft while it is valid; off puts the previous asset back." /> : null}
      </div>
      {note ? <Note tone={note.tone}>{note.text}</Note> : null}
      {isChromeType(type) ? <Note tone="info">Every {chromeLabel(type).toLowerCase()} also has a settings interface (chrome-settings@1), itself an asset. <Button size="sm" icon="settings" onClick={() => void openChrome(type)}>Settings interface…</Button></Note> : null}
      {chromeOf ? <Note tone="info">This settings asset is the settings interface of every {chromeLabel(chromeOf).toLowerCase()}: its tabs, groups, levels and visibility are the tokens below.</Note> : null}
      {g.general.length ? <Note tone="danger"><ul className="axp-asset-designer__errors">{g.general.map((e) => <li key={e}>{e}</li>)}</ul></Note> : null}

      <Container title="Asset" icon="tag">
        <div className="axp-asset-designer__envelope">
          <TextField label="Id" mono value={asset.id} onChange={(v) => patch({ id: v })} error={g.byField.id?.join(' · ')} hint="2–48 lowercase letters, digits and dashes; built-in ids are refused on save." required />
          <TextField label="Name" value={asset.name} onChange={(v) => patch({ name: v, ...(isNew && !asset.id ? { id: suggestId(v, savedOfType.map((a) => a.id)) } : {}) })} error={g.byField.name?.join(' · ')} required />
          <TextField label="Version" mono value={asset.version} onChange={(v) => patch({ version: v })} error={g.byField.version?.join(' · ')} hint="Bumped on every save (designed@1)." />
          <TextField label="Tags" value={(asset.tags ?? []).join(', ')} onChange={(v) => patch({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) })} hint="Comma separated." />
          <div className="axp-asset-designer__wide"><TextField label="Description" rows={2} value={asset.description ?? ''} onChange={(v) => patch({ description: v })} /></div>
        </div>
      </Container>

      <TabGroup id="asset-designer.editor" label="Asset designer sections" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ ...t, badge: t.value === 'fields' && !g.ok ? Object.keys(g.byField).length : undefined }))} />

      {tab === 'fields' ? (
        <Container title={`${spec[type]?.label ?? type} fields`} icon={spec[type]?.icon ?? 'sliders'}>
          {fields.length ? groups.map((grp) => { const list = fields.filter((f) => f.group === grp.id); return list.length ? (
            <div key={grp.id} className="axp-asset-designer__group">
              <p className="fx-eyebrow">{grp.title}</p>
              <div className="axp-asset-designer__fields">{list.map(renderField)}</div>
            </div>
          ) : null; }) : <p className="fx-muted">This type registers no fields of its own; edit its data in the JSON tab.</p>}
        </Container>
      ) : null}

      {tab === 'json' ? (
        <Container title="Data (JSON)" icon="code" actions={<Button size="sm" icon="check" onClick={applyJson}>Apply JSON</Button>}>
          <TextField label="Data (JSON)" mono rows={18} value={jsonText} onChange={setJsonText} error={jsonError || undefined} hint="The asset's whole data object. Apply runs the validation gate." />
        </Container>
      ) : null}

      {tab === 'preview' ? (
        <Container title="Preview" icon="eye">
          <div className="axp-asset-designer__preview">
            {g.ok ? <div className="axp-asset-designer__previewbox"><AssetPreview asset={stripDesigned(asset) as unknown as AssetEnvelope} /></div> : <Note tone="warning">Fix the problems first; the preview draws valid assets only.</Note>}
            {previewable(spec, type) ? <p className="fx-muted">Live preview puts this draft on the real chrome (slot {type}) while it is valid.</p> : <p className="fx-muted">This type is not a slot of its own (a widget or a collection), so there is no live swap; the preview above is what its host would draw.</p>}
          </div>
        </Container>
      ) : null}

      {tab === 'manifest' ? (
        <Container title="Manifest (designed@1)" icon="file">
          {asset.designed ? (
            <dl className="axp-asset-designer__manifest">
              {Object.entries(asset.designed as Record<string, unknown>).filter(([k]) => k !== '$axf').map(([k, v]) => <ManifestRow key={k} k={k} v={v} />)}
            </dl>
          ) : <Note tone="info">Not saved yet: the first save gives this asset its identifier (uid), revision 1 and a hash of its data; every save after that bumps the revision and keeps the uid.</Note>}
        </Container>
      ) : null}
    </div>
  );
}

function ManifestRow({ k, v }: { k: string; v: unknown }) {
  return <><dt>{k}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></>;
}
