/**
 * Settings → Appearance → Where the skin applies + What a skin covers (build skins-asset-types, Nov 2026).
 *
 * The skin chain (skin-coverage@1): hub-wide → this app → one screen → one plugin, the child overrides the parent.
 * This module draws it three ways, picked by the look setting `axf.skin.whereLayout` (Brett asked for three UI options
 * in UI Review; every one is live and switchable):
 *   rows    every level as a settings row (Inherit / Skin / Off + the skin), the covers list in a collapsible container
 *   dialog  one summary row with Change…; the levels and the covers live in a dialog
 *   matrix  one table: a line per level with its mode, skin, icon pack and parts; the covers as a chip grid
 * Data comes only from the runtime: `rt.skinScopes()`, `rt.scopeSkin()`, `rt.skinAt()`, `rt.skinCoverage()`,
 * `rt.skinCovers()`, `rt.libraries` (plugins) and the active nav-menu asset (screens). Tokens only, framework controls only.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../core/runtime';
import type { NavItem, NavMenuData } from '../../core/types';
import type { CoverageRow } from '../../core';
import { Button, Chip, Container, Segmented, Switch, useAxfState, useRuntime } from '../../react';

export const SKIN_WHERE_LAYOUT_KEY = 'axf.skin.whereLayout';
export const SKIN_WHERE_DIALOG = 'axf.settings.skin-where';
export type WhereLayout = 'rows' | 'dialog' | 'matrix';
const LAYOUTS: { value: WhereLayout; label: string; title: string }[] = [
  { value: 'rows', label: 'Rows', title: 'Every level as a settings row' },
  { value: 'dialog', label: 'Dialog', title: 'One summary row; the levels open in a dialog' },
  { value: 'matrix', label: 'Matrix', title: 'One table of every level' },
];
type Use = 'on' | 'off' | 'inherit';
const USES: { value: Use; label: string; title: string }[] = [
  { value: 'inherit', label: 'Inherit', title: 'Take the parent level\'s skin' },
  { value: 'on', label: 'Skin', title: 'Its own skin, inside it only' },
  { value: 'off', label: 'Off', title: 'No skin inside it, whatever the parent has' },
];
const KIND_LABEL: Record<CoverageRow['by'], string> = {
  slot: 'Picked as a slot',
  parts: 'Styled through parts',
  reference: 'Named by reference',
  bundle: 'The skin itself',
  none: 'No look to skin',
  uncovered: 'Not covered',
};
const KIND_HINT: Record<CoverageRow['by'], string> = {
  slot: 'the skin picks which asset of the type is active',
  parts: 'the skin styles the type\'s box, text, icon and items wherever it is drawn',
  reference: 'the skin names it through a field or an asset it picks',
  bundle: 'a whole look the skin stands in for',
  none: 'declared in the registry as having no look',
  uncovered: 'a skin cannot reach it (CI fails on this)',
};

export function useWhereLayout(rt: AxfRuntime): WhereLayout {
  useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision);
  const v = rt.settings.get(SKIN_WHERE_LAYOUT_KEY);
  return v === 'dialog' || v === 'matrix' ? v : 'rows';
}

/** Screens (nav items with a view) and plugins (installed libraries) a level can be set for. */
function candidates(rt: AxfRuntime): { screens: { id: string; label: string }[]; plugins: { id: string; label: string }[] } {
  const screens: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  const walk = (items: NavItem[] | undefined) => {
    for (const it of items ?? []) {
      if (it.view && !seen.has(it.view)) { seen.add(it.view); screens.push({ id: it.view, label: it.label || it.view }); }
      walk((it as NavItem & { children?: NavItem[] }).children);
    }
  };
  const nav = rt.assetOrNull('nav-menu')?.data as NavMenuData | undefined;
  for (const s of nav?.sections ?? []) walk(s.items);
  const plugins = rt.libraries.map((l) => ({ id: l.id, label: l.label || l.id })).sort((a, b) => a.label.localeCompare(b.label));
  return { screens, plugins };
}

function levelLabel(key: string, c: ReturnType<typeof candidates>): { kind: 'ui' | 'plugin'; label: string } {
  if (key.startsWith('plugin:')) { const id = key.slice(7); return { kind: 'plugin', label: c.plugins.find((p) => p.id === id)?.label ?? id }; }
  const id = key.slice(3);
  return { kind: 'ui', label: c.screens.find((s) => s.id === id)?.label ?? id };
}

/** One UI / plugin level: its mode, its skin, and a way back to inherit. */
function LevelRow({ keyId, locked }: { keyId: string; locked: boolean }) {
  const rt = useRuntime();
  const c = candidates(rt);
  const { kind, label } = levelLabel(keyId, c);
  const state = rt.skinScopes().find((s) => s.key === keyId) ?? { use: 'inherit' as Use, id: '', overrides: {} };
  const skins = rt.skinList();
  const scope = kind === 'plugin' ? { plugin: keyId.slice(7) } : { ui: keyId.slice(3) };
  const inForce = rt.skinAt(scope);
  const hint = state.use === 'inherit' ? (inForce.id ? `Inherits ${skins.find((s) => s.id === inForce.id)?.name ?? inForce.id} from ${fromLabel(inForce.from)}.` : 'Inherits: no skin here.') : state.use === 'off' ? 'No skin inside it.' : `${skins.find((s) => s.id === state.id)?.name ?? state.id}, inside it only.`;
  return (
    <div className="axf-settings__row axf-skin__level" data-axf-skin-level={keyId}>
      <div className="axf-settings__label">
        <span><Chip tone={kind === 'plugin' ? 'accent' : undefined}>{kind === 'plugin' ? 'Plugin' : 'Screen'}</Chip> {label}</span>
        <span className="fx-muted axf-settings__hint">{hint}</span>
      </div>
      <div className="axf-settings__control axf-skin__action">
        <Segmented size="sm" label={`${label}: skin`} value={state.use} disabled={locked} options={USES} onChange={(use) => rt.scopeSkin(keyId, use)} />
        {state.use === 'on' && (
          <select className="axf-settings__field" aria-label={`${label}: which skin`} value={state.id} disabled={locked} onChange={(e) => rt.scopeSkin(keyId, 'on', e.target.value)}>
            {skins.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {state.use !== 'inherit' && <Button size="sm" tone="quiet" icon="x" disabled={locked} title="Back to inherit" onClick={() => rt.scopeSkin(keyId, 'inherit')}>Inherit</Button>}
      </div>
    </div>
  );
}

function fromLabel(from: string): string {
  if (from === 'global') return 'the hub';
  if (from === 'app') return 'this app';
  if (from.startsWith('plugin:')) return 'its plugin';
  if (from.startsWith('ui:')) return 'its screen';
  return 'nowhere';
}

/** Add a level: a select of every screen and plugin not yet listed. */
function AddLevel({ locked }: { locked: boolean }) {
  const rt = useRuntime();
  const c = candidates(rt);
  const listed = new Set(rt.skinScopes().map((s) => s.key));
  const screens = c.screens.filter((s) => !listed.has(`ui:${s.id}`));
  const plugins = c.plugins.filter((p) => !listed.has(`plugin:${p.id}`));
  if (!screens.length && !plugins.length) return null;
  return (
    <div className="axf-settings__row">
      <div className="axf-settings__label"><span>Add a screen or plugin</span><span className="fx-muted axf-settings__hint">Give one part of the app its own skin, or no skin.</span></div>
      <div className="axf-settings__control">
        <select className="axf-settings__field" aria-label="Add a screen or plugin" value="" disabled={locked} onChange={(e) => { if (e.target.value) rt.scopeSkin(e.target.value, 'on'); }}>
          <option value="">Choose…</option>
          {screens.length > 0 && <optgroup label="Screens">{screens.map((s) => <option key={s.id} value={`ui:${s.id}`}>{s.label}</option>)}</optgroup>}
          {plugins.length > 0 && <optgroup label="Plugins">{plugins.map((p) => <option key={p.id} value={`plugin:${p.id}`}>{p.label}</option>)}</optgroup>}
        </select>
      </div>
    </div>
  );
}

/** The Follow-the-hub switch: the global level of the chain. */
export function FollowHubSwitch({ locked }: { locked: boolean }) {
  const rt = useRuntime();
  useAxfState();
  useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision);
  const look = rt.appLook();
  const global = rt.globalSkin();
  const name = global ? rt.skinList().find((s) => s.id === global.id)?.name ?? global.id : '';
  const skinOn = !!look?.skin.use;
  return (
    <Switch label="Follow the hub-wide skin" checked={!!look?.skin.inherit} disabled={locked || skinOn}
      hint={skinOn ? 'Use skin is on: this app\'s own skin wins.' : global ? `axHub's skin is ${name}. On = this app takes it, off = this app keeps its own look.` : 'axHub has no hub-wide skin yet (set one with skins.mjs use --global).'}
      onChange={(on) => { rt.skinInherit(on); }} />
  );
}

/** What a skin covers: every registered type grouped by how a skin reaches it; the current skin's picks lit. */
export function SkinCovers({ skinId, compact = false }: { skinId: string; compact?: boolean }) {
  const rt = useRuntime();
  const rows = rt.skinCoverage();
  const covers = skinId ? rt.skinCovers(skinId) : [];
  const by = new Map(covers.map((c) => [c.type, c]));
  const kinds = (['slot', 'parts', 'reference', 'bundle', 'none', 'uncovered'] as CoverageRow['by'][]).map((k) => ({ k, rows: rows.filter((r) => r.by === k) })).filter((g) => g.rows.length);
  const total = rows.length;
  const uncovered = rows.filter((r) => r.by === 'uncovered').length;
  const set = covers.filter((c) => c.covered).length;
  return (
    <div className="axf-skin__covers" data-axf-skin-covers="">
      <p className="fx-muted axf-settings__hint">
        {uncovered ? `${uncovered} of ${total} asset types have no skin coverage (CI fails on this).` : `Every registered asset type is covered (${total} of ${total}); a new type is checked in CI.`}
        {skinId ? ` This skin sets or styles ${set} of them.` : ''}
      </p>
      {kinds.map(({ k, rows: list }) => (
        <div key={k} className="axf-skin__kind">
          <span className="axf-skin__kindlabel" title={KIND_HINT[k]}>{KIND_LABEL[k]} <span className="fx-muted">({list.length})</span></span>
          <div className={`axf-skin__chips${compact ? ' is-compact' : ''}`}>
            {list.map((r) => {
              const c = by.get(r.type);
              return <span key={r.type} className={`fx-chip axf-skin__chip${c?.covered ? ' is-set' : ''}${k === 'uncovered' ? ' is-missing' : ''}`} title={`${r.label}: ${KIND_HINT[k]}${r.elements.length ? ` · parts: ${r.elements.join(', ')}` : ''}${c?.how.length ? ` · ${c.how.join('; ')}` : ''}`}>{r.label}</span>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The whole Where section in the layout the setting picks. */
export function SkinWhere({ locked }: { locked: boolean }) {
  const rt = useRuntime();
  useAxfState();
  const layout = useWhereLayout(rt);
  const inForce = rt.skinInForce();
  const skins = rt.skinList();
  const skinName = inForce.id ? skins.find((s) => s.id === inForce.id)?.name ?? inForce.id : '';
  const scopes = rt.skinScopes();
  const summary = `${skinName ? `${skinName} from ${fromLabel(inForce.from)}` : 'This app\'s own look'}${scopes.length ? ` · ${scopes.filter((s) => s.key.startsWith('plugin:')).length} plugin(s), ${scopes.filter((s) => s.key.startsWith('ui:')).length} screen(s) set their own` : ''}.`;
  const header = (
    <div className="axf-settings__row">
      <div className="axf-settings__label"><p className="fx-eyebrow">Where the skin applies</p><span className="fx-muted axf-settings__hint">Hub-wide → this app → a screen → a plugin: the nearer level wins.</span></div>
      <div className="axf-settings__control axf-skin__action"><Segmented size="sm" label="How this section is shown" value={layout} options={LAYOUTS} onChange={(v) => rt.settings.set(SKIN_WHERE_LAYOUT_KEY, v)} /></div>
    </div>
  );
  if (layout === 'dialog') {
    return (
      <div className="axf-skin__where" data-axf-skin-where="dialog">
        {header}
        <div className="axf-settings__row">
          <div className="axf-settings__label"><span>Where</span><span className="fx-muted axf-settings__hint">{summary}</span></div>
          <div className="axf-settings__control axf-skin__action"><Button size="sm" icon="layers" disabled={locked} onClick={() => rt.openDialog(SKIN_WHERE_DIALOG, {})}>Change…</Button></div>
        </div>
      </div>
    );
  }
  if (layout === 'matrix') {
    const c = candidates(rt);
    const global = rt.globalSkin();
    const skinOf = (id: string) => skins.find((s) => s.id === id);
    const lines = [
      { key: 'global', label: 'Hub-wide (axHub)', mode: global ? 'Skin' : 'None', skin: global ? skinOf(global.id)?.name ?? global.id : '—', sub: 'every app that follows it' },
      { key: 'app', label: 'This app', mode: rt.appLook()?.skin.use ? 'Skin' : rt.appLook()?.skin.inherit ? 'Inherit' : 'Own look', skin: skinName || '—', sub: inForce.id ? `from ${fromLabel(inForce.from)}` : 'the snapshot + its picks' },
      ...scopes.map((s) => { const l = levelLabel(s.key, c); const at = rt.skinAt(s.key.startsWith('plugin:') ? { plugin: s.key.slice(7) } : { ui: s.key.slice(3) }); return { key: s.key, label: l.label, mode: s.use === 'on' ? 'Skin' : s.use === 'off' ? 'Off' : 'Inherit', skin: at.id ? skinOf(at.id)?.name ?? at.id : '—', sub: l.kind === 'plugin' ? 'plugin' : 'screen' }; }),
    ];
    return (
      <div className="axf-skin__where" data-axf-skin-where="matrix">
        {header}
        <table className="axf-skin__matrix">
          <thead><tr><th>Level</th><th>Mode</th><th>Skin</th><th>Icon pack</th><th>Parts</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {lines.map((l) => {
              const s = l.skin !== '—' ? skins.find((x) => x.name === l.skin) : undefined;
              return (
                <tr key={l.key} data-axf-skin-level={l.key}>
                  <td><span>{l.label}</span><span className="fx-muted axf-settings__hint"> {l.sub}</span></td>
                  <td>{l.key === 'global' || l.key === 'app' ? l.mode : <Segmented size="sm" label={`${l.label}: skin`} value={(scopes.find((x) => x.key === l.key)?.use ?? 'inherit') as Use} disabled={locked} options={USES} onChange={(use) => rt.scopeSkin(l.key, use)} />}</td>
                  <td>{l.key !== 'global' && l.key !== 'app' && scopes.find((x) => x.key === l.key)?.use === 'on'
                    ? <select className="axf-settings__field" aria-label={`${l.label}: which skin`} value={scopes.find((x) => x.key === l.key)?.id ?? ''} disabled={locked} onChange={(e) => rt.scopeSkin(l.key, 'on', e.target.value)}>{skins.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
                    : l.skin}</td>
                  <td>{s?.data.iconPack ?? '—'}</td>
                  <td>{s?.data.parts ? Object.keys(s.data.parts).length : 0}</td>
                  <td>{l.key !== 'global' && l.key !== 'app' && <Button size="sm" tone="quiet" icon="x" disabled={locked} title="Back to inherit" onClick={() => rt.scopeSkin(l.key, 'inherit')}>Inherit</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <AddLevel locked={locked} />
        <p className="fx-eyebrow">What a skin covers</p>
        <SkinCovers skinId={inForce.id} compact />
      </div>
    );
  }
  return (
    <div className="axf-skin__where" data-axf-skin-where="rows">
      {header}
      <div className="axf-settings__row">
        <div className="axf-settings__label"><span>This app</span><span className="fx-muted axf-settings__hint">{summary}</span></div>
      </div>
      {scopes.map((s) => <LevelRow key={s.key} keyId={s.key} locked={locked} />)}
      <AddLevel locked={locked} />
      <Container title={`What a skin covers (${rt.skinCoverage().length} asset types)`} icon="layers" collapsible defaultOpen={false}>
        <SkinCovers skinId={inForce.id} />
      </Container>
    </div>
  );
}

/** The dialog layout's body: the levels and the covers. */
export function SkinWhereDialog() {
  const rt = useRuntime();
  useAxfState();
  const locked = !rt.can('assets.swap') || rt.lockedByAppearance('assets.swap');
  const inForce = rt.skinInForce();
  return (
    <div className="fx-stack" data-axf-skin-where-dialog="">
      <FollowHubSwitch locked={locked} />
      {rt.skinScopes().map((s) => <LevelRow key={s.key} keyId={s.key} locked={locked} />)}
      <AddLevel locked={locked} />
      <Container title="What a skin covers" icon="layers" collapsible defaultOpen={false}>
        <SkinCovers skinId={inForce.id} />
      </Container>
      <div className="fx-row"><Button tone="quiet" onClick={() => rt.closeDialog()}>Close</Button></div>
    </div>
  );
}

/** Tokens only (framework/core/engines/theme.ts + framework/ui/axf.css). */
export const SKIN_WHERE_CSS = `
.axf-skin__where{display:flex;flex-direction:column;gap:var(--fx-dens-gap-2xl)}
.axf-skin__level .axf-settings__field{flex:1 1 auto;min-width:0;width:auto}
.axf-skin__covers{display:flex;flex-direction:column;gap:var(--fx-dens-gap-lg)}
.axf-skin__kind{display:flex;flex-direction:column;gap:var(--fx-dens-gap-xs)}
.axf-skin__kindlabel{font-size:var(--fx-type-scale-sm);font-weight:600}
.axf-skin__chips{display:flex;flex-wrap:wrap;gap:var(--fx-dens-gap-xs)}
.axf-skin__chips.is-compact .axf-skin__chip{font-size:var(--fx-type-scale-xs)}
.axf-skin__chip{opacity:var(--fx-opacity-muted)}
.axf-skin__chip.is-set{opacity:1;border-color:var(--fx-accent);color:var(--fx-accent)}
.axf-skin__chip.is-missing{border-color:var(--fx-danger);color:var(--fx-danger);opacity:1}
.axf-skin__matrix{width:100%;border-collapse:collapse;font-size:var(--fx-type-scale-sm)}
.axf-skin__matrix th,.axf-skin__matrix td{text-align:left;padding:var(--fx-dens-gap-sm) var(--fx-dens-gap-md);border-bottom:var(--fx-border-w) solid var(--fx-border);vertical-align:middle}
.axf-skin__matrix th{font-weight:600;color:var(--fx-muted)}
.axf-skin__matrix .axf-settings__field{width:auto;min-width:0}
[data-fx-small] .axf-skin__matrix thead{display:none}
[data-fx-small] .axf-skin__matrix tr{display:flex;flex-wrap:wrap;gap:var(--fx-dens-gap-sm);padding:var(--fx-dens-gap-sm) 0;border-bottom:var(--fx-border-w) solid var(--fx-border)}
[data-fx-small] .axf-skin__matrix td{border:0;padding:0}
[data-fx-small] .axf-skin__matrix td:first-child{flex:1 0 100%}
`;
