/**
 * Status styles console plugin (ai.amberx.axf.console.status-styles).
 *
 * Brett, Nov 21 2026: animations and styling for every status level, for builds and every step. While something is
 * being worked on its whole row moves (slow blink, a fade sweeping left to right, pulse, shimmer…) or only its text
 * does; a library of presets, his own presets, one pick per status.
 *
 * Display only. Pages mark a status the VPS sent as `data-status="<id>"`; this plugin keeps one generated stylesheet
 * in the document head that finds those marks (web/core.ts) and one attribute on the root, `data-status-animated`,
 * listing the statuses whose badge moves (what a badge pack reads). It never reads a build, never decides a status and
 * touches no other plugin: switch it off and the stylesheet is gone.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Container, Note, Segmented, SelectField, Slider, Switch, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import * as consoleApi from '@console/api';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './status-styles.css';
import * as C from './core';
import type { Config, Preset, SavedConfig, StatusStyle, Target } from './core';
import { appMenu } from './menu';

const FOLDER = 'status-styles';
const ID = 'ai.amberx.axf.console.status-styles';
const CACHE_KEY = 'status-styles.cache';
const DRAFT_ID = 'draft';
const api = pluginApi(FOLDER, 'Status styles');

interface Reply { config: SavedConfig; presets: unknown[] }
interface State { saved: SavedConfig; own: unknown[]; error: string; loaded: boolean }

/* ---------------- store: the saved picks, and the stylesheet made from them ---------------- */

let st: State = { ...consoleApi.readLocal<{ saved: SavedConfig; own: unknown[] }>(CACHE_KEY, { saved: {}, own: [] }), error: '', loaded: false };
const subs = new Set<() => void>();
const useStore = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

function sheet(name: string): HTMLStyleElement {
  const found = document.head.querySelector<HTMLStyleElement>(`style[data-axf-plugin-style="${name}"]`);
  if (found) return found;
  const el = document.createElement('style');
  el.setAttribute('data-axf-plugin-style', name);
  document.head.appendChild(el);
  return el;
}

/** Write the stylesheet and the root attribute from what is saved. */
function paint() {
  const cfg = C.resolveConfig(st.saved);
  sheet(FOLDER).textContent = C.buildCss(cfg, C.allPresets(st.own));
  const moving = C.animatedStatuses(cfg);
  if (moving.length) document.documentElement.setAttribute('data-status-animated', moving.join(' ')); else document.documentElement.removeAttribute('data-status-animated');
}

function set(p: Partial<State>) {
  st = { ...st, ...p };
  consoleApi.writeLocal(CACHE_KEY, { saved: st.saved, own: st.own });
  paint();
  subs.forEach((f) => f());
}

const take = (r: Reply) => set({ saved: r.config ?? {}, own: Array.isArray(r.presets) ? r.presets : [], error: '', loaded: true });
const fail = (e: unknown) => set({ error: (e as Error).message, loaded: true });
const load = () => api.call<Reply>('config').then(take, fail);

/** Save a changed config: shown at once, then confirmed by the server's answer. */
function saveConfig(cfg: Config) {
  const saved = C.savedFrom(cfg);
  set({ saved });
  void api.put<Reply>('config', saved).then(take, fail);
}
const resetConfig = () => api.put<Reply>('config', { reset: true }).then(take, fail);
const savePreset = (p: Preset) => api.post<{ presets: unknown[] }>('presets', p).then((r) => set({ own: r.presets, error: '' }));
const removePreset = (id: string) => api.del<{ presets: unknown[] }>(`presets/${encodeURIComponent(id)}`).then((r) => set({ own: r.presets, error: '' }), fail);

/* ---------------- the preset maker's draft (the library's "Edit a copy" fills it) ---------------- */

const BLANK: Preset = { id: DRAFT_ID, name: '', target: 'row', effect: 'sweep', tone: 'accent', speed: 100, strength: 60, direction: 'normal', tint: 0, edge: false, bold: false, italic: false, dim: 0 };
let draft: Preset = BLANK;
const draftSubs = new Set<() => void>();
const setDraft = (p: Preset) => { draft = p; draftSubs.forEach((f) => f()); };
const useDraft = () => useSyncExternalStore((f) => { draftSubs.add(f); return () => draftSubs.delete(f); }, () => draft);

/** The preview stylesheet lives only while a panel that shows previews is open. */
function usePreviewSheet(name: string, css: string) {
  useEffect(() => { const el = sheet(`${FOLDER}.${name}`); el.textContent = css; return () => el.remove(); }, [name, css]);
}

/* ---------------- samples ---------------- */

/** A stand-in row carrying a real status mark, so it is drawn by the same stylesheet as every page. */
function StatusSample({ id, label }: { id: string; label: string }) {
  return (
    <div className="axp-status-styles__sample" data-status-row aria-hidden="true">
      <span><strong>Sample build</strong> <span className="fx-muted fx-small">3/5 steps · 4m 12s</span></span>
      <span data-status={id}><Chip>{label}</Chip></span>
    </div>
  );
}

function PresetSample({ preset, text = 'Sample build' }: { preset: string; text?: string }) {
  return (
    <div className="axp-status-styles__sample" data-axp-status-styles-preview={preset} aria-hidden="true">
      <strong>{text}</strong>
    </div>
  );
}

/* ---------------- settings: one style per status ---------------- */

function StatusRow({ id, style, presets, onChange, onRemove }: { id: string; style: StatusStyle; presets: Preset[]; onChange: (s: StatusStyle) => void; onRemove?: () => void }) {
  const options = useMemo(() => presets.map((p) => ({ value: p.id, label: p.own ? `${p.name} (yours)` : p.name })), [presets]);
  return (
    <div className="axp-status-styles__status">
      <StatusSample id={id} label={style.label} />
      <div className="axp-status-styles__picks">
        <SelectField label="Row style" value={style.preset} options={options} onChange={(v) => onChange({ ...style, preset: v })} />
        <SelectField label="Badge style" value={style.badgePreset} options={options} onChange={(v) => onChange({ ...style, badgePreset: v })} />
        <Switch label="Animated badge" hint="Moving status" checked={style.animated} onChange={(v) => onChange({ ...style, animated: v })} />
        {onRemove && <Button icon="x" onClick={onRemove}>Remove status</Button>}
      </div>
    </div>
  );
}

function StylesPanel() {
  const s = useStore();
  const [fresh, setFresh] = useState('');
  useEffect(() => { void load(); }, []);
  const cfg = useMemo(() => C.resolveConfig(s.saved), [s.saved]);
  const presets = useMemo(() => C.allPresets(s.own), [s.own]);
  const freshId = C.slug(fresh);
  const change = (id: string, style: StatusStyle) => saveConfig({ ...cfg, statuses: { ...cfg.statuses, [id]: style } });
  const remove = (id: string) => { const { [id]: _gone, ...statuses } = cfg.statuses; saveConfig({ ...cfg, statuses }); };
  const add = () => {
    if (!freshId || cfg.statuses[freshId]) return;
    change(freshId, { label: fresh.trim().slice(0, 40), group: C.OWN_GROUP, preset: C.PLAIN, badgePreset: C.PLAIN, animated: false, custom: true });
    setFresh('');
  };
  return (
    <div className="fx-stack">
      <p className="axp-status-styles__note">Every status the console shows can carry a style: on the whole row, on the row's text, and on its badge. The status itself always comes from the VPS; this only decides how it looks. Changes save as you make them.</p>
      {s.error && <Note tone="warning">{s.error}</Note>}
      <div className="fx-row fx-row--wrap">
        <Switch label="Status styles on" checked={cfg.enabled} onChange={(v) => saveConfig({ ...cfg, enabled: v })} />
        <Switch label="Style rows" checked={cfg.rows} disabled={!cfg.enabled} onChange={(v) => saveConfig({ ...cfg, rows: v })} />
        <Switch label="Style badges" checked={cfg.badges} disabled={!cfg.enabled} onChange={(v) => saveConfig({ ...cfg, badges: v })} />
      </div>
      {C.statusGroups(cfg).map((g, i) => (
        <Container key={g.group} title={`${g.group} (${g.items.length})`} icon="layers" collapsible defaultOpen={i === 0}>
          {g.items.map(({ id, style }) => <StatusRow key={id} id={id} style={style} presets={presets} onChange={(v) => change(id, v)} onRemove={style.custom ? () => remove(id) : undefined} />)}
        </Container>
      ))}
      <div className="axp-status-styles__picks">
        <TextField label="New status" value={fresh} placeholder="e.g. waiting-review" hint={freshId && cfg.statuses[freshId] ? 'That status is already listed.' : 'For a status that is not listed yet: its id as the VPS sends it.'} onChange={setFresh} />
        <Button icon="plus" disabled={!freshId || !!cfg.statuses[freshId]} onClick={add}>Add status</Button>
        <Button icon="refresh" confirm="Put every status back to its shipped style? Your own presets are kept." onClick={() => void resetConfig()}>Back to the shipped styles</Button>
      </div>
    </div>
  );
}

/* ---------------- settings: the preset library ---------------- */

type Filter = 'all' | 'row' | 'text' | 'own';
const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'row', label: 'Whole row' }, { value: 'text', label: 'Text only' }, { value: 'own', label: 'Yours' }];

function LibraryPanel() {
  const s = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const presets = useMemo(() => C.allPresets(s.own), [s.own]);
  usePreviewSheet('library', useMemo(() => C.previewCss(presets), [presets]));
  const shown = presets.filter((p) => filter === 'all' || (filter === 'own' ? p.own : p.target === filter));
  return (
    <div className="fx-stack">
      <p className="axp-status-styles__note">{presets.length} presets, each playing as it would on a row. Pick one for a status above, or edit a copy to make your own.</p>
      <Segmented label="Show presets" value={filter} options={FILTERS} onChange={setFilter} />
      {!shown.length && <p className="fx-muted axp-status-styles__note">None yet. Make one below and save it.</p>}
      <div className="axp-status-styles__library">
        {shown.map((p) => (
          <div key={p.id} className="axp-status-styles__card">
            <PresetSample preset={p.id} text={p.name} />
            <div className="fx-row fx-row--wrap">
              <Button size="sm" icon="copy" onClick={() => setDraft({ ...p, id: DRAFT_ID, own: undefined, name: p.own ? p.name : `My ${p.name.toLowerCase()}` })}>Edit a copy</Button>
              {p.own && <Button size="sm" icon="x" confirm={`Remove your preset "${p.name}"? Statuses using it go back to no style.`} onClick={() => void removePreset(p.id)}>Remove preset</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- settings: make a preset ---------------- */

const TARGET_OPTIONS: { value: Target; label: string }[] = [{ value: 'row', label: 'Whole row' }, { value: 'text', label: 'Text only' }];
const options = (ids: string[], labels: Record<string, string>) => ids.map((v) => ({ value: v, label: labels[v] ?? v }));

function MakerPanel() {
  const d = useDraft();
  const [msg, setMsg] = useState('');
  const clean = useMemo(() => C.cleanPreset(d) ?? BLANK, [d]);
  usePreviewSheet('draft', useMemo(() => C.previewCss([clean]), [clean]));
  const edit = (p: Partial<Preset>) => { setMsg(''); setDraft({ ...d, ...p }); };
  const id = `my-${C.slug(d.name, 50)}`;
  const save = () => savePreset({ ...clean, id }).then(() => setMsg(`Saved "${d.name.trim()}". It is in the library and in every style list.`), (e: Error) => setMsg(e.message));
  return (
    <div className="fx-stack">
      <PresetSample preset={DRAFT_ID} text={d.name.trim() || 'Your preset'} />
      <div className="axp-status-styles__picks">
        <TextField label="Preset name" value={d.name} placeholder="e.g. Calm green sweep" onChange={(v) => edit({ name: v })} />
        <Segmented label="Applies to" value={d.target} options={TARGET_OPTIONS} onChange={(v) => edit({ target: v, effect: v === 'text' && !C.TEXT_EFFECTS.includes(d.effect) ? 'pulse' : d.effect })} />
        <SelectField label="Effect" value={clean.effect} options={options(d.target === 'text' ? C.TEXT_EFFECTS : C.EFFECTS, C.EFFECT_LABEL)} onChange={(v) => edit({ effect: v })} />
        <SelectField label="Colour" value={d.tone} options={options(C.TONES, C.TONE_LABEL)} onChange={(v) => edit({ tone: v })} />
        <SelectField label="Direction" value={d.direction} options={options(C.DIRECTIONS, C.DIRECTION_LABEL)} onChange={(v) => edit({ direction: v })} />
      </div>
      <div className="axp-status-styles__picks">
        <Slider label="Speed" value={d.speed} min={C.LIMITS.speed[0]} max={C.LIMITS.speed[1]} step={5} unit="%" onChange={(v) => edit({ speed: v })} />
        <Slider label="Strength" value={d.strength} min={C.LIMITS.strength[0]} max={C.LIMITS.strength[1]} step={5} unit="%" onChange={(v) => edit({ strength: v })} />
        <Slider label="Still tint" value={d.tint} min={C.LIMITS.tint[0]} max={C.LIMITS.tint[1]} step={2} unit="%" onChange={(v) => edit({ tint: v })} />
        <Slider label="Dim" value={d.dim} min={C.LIMITS.dim[0]} max={C.LIMITS.dim[1]} step={5} unit="%" onChange={(v) => edit({ dim: v })} />
      </div>
      <div className="fx-row fx-row--wrap">
        <Switch label="Edge bar" checked={d.edge} onChange={(v) => edit({ edge: v })} />
        <Switch label="Bold" checked={d.bold} onChange={(v) => edit({ bold: v })} />
        <Switch label="Italic" checked={d.italic} onChange={(v) => edit({ italic: v })} />
      </div>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="check" disabled={!C.slug(d.name)} onClick={() => void save()}>Save preset</Button>
        <Button icon="refresh" onClick={() => { setMsg(''); setDraft(BLANK); }}>Start over</Button>
      </div>
      {msg && <p className="fx-small axp-status-styles__note" role="status">{msg}</p>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID,
  label: 'Status styles',
  version: '0.1.0',
  provides: ['status-styles@1'],
  register(rt) {
    rt.actions.register('status-styles.open', () => rt.dispatch(`settings.open:${FOLDER}`), { label: 'Open Status styles' });
    rt.actions.register('status-styles.refresh', () => void load(), { label: 'Reload the status styles' });
    paint(); // the last known styles at once, then the saved ones
    void load();
  },
  settingsTabs: [{ id: FOLDER, label: 'Status styles', icon: 'sparkles', parent: 'plugins', order: 48, description: 'Animations and styling for every status.' }],
  settingsPanels: [
    { id: 'status-styles.statuses', tab: FOLDER, title: 'A style for every status', icon: 'sparkles', order: 10, render: () => <StylesPanel /> },
    { id: 'status-styles.library', tab: FOLDER, title: 'Preset library', icon: 'palette', order: 20, render: () => <LibraryPanel /> },
    { id: 'status-styles.maker', tab: FOLDER, title: 'Make a preset', icon: 'edit', order: 30, render: () => <MakerPanel /> },
    { id: 'status-styles.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
