/**
 * Settings → Appearance → Skin config (skin-config@1, build skin-configuration-panel, Nov 2026, Brett: "before AI makes
 * a skin, Brett picks what it may change").
 *
 * The permission tree (core/engines/skin-config-rules.mjs: category > group > option, built from the asset registry)
 * with an allow / lock switch on every category, group and option, steppers for the limits a type declares (how deep
 * the AI may build context menus, nav and app menus; how many toolbar groups), the Default skin row (the current look,
 * saved as a protected skin) and Make skin with AI. Three layouts, picked by the look setting `axf.skinConfig.layout`
 * (UI Review options, one `settings` asset each, tagged `ui-choices:skin-config`, `data.view` naming the layout:
 * framework/assets/settings/skin-config-{tree,columns,chips}.json):
 *   tree     a collapsible container per category, groups and options inside, each with its switch
 *   columns  the categories on the left, the picked one's groups and options on the right
 *   chips    every category as one chip (tap = allow / lock), the limits as steppers below
 * Data comes from the capability `axf.skin-config@1` on `globalThis.__axfWebServices` (whatever in the app provides
 * it: REST on the console); the framework names no plugin. Without a provider the panel says so. Tokens only,
 * framework controls only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Note, Segmented, Switch, TabGroup, TextField, useRuntime } from '../../react';
import type { AxfRuntime } from '../../core/runtime';

export const SKIN_CONFIG_SERVICE = 'axf.skin-config@1';
export const SKIN_CONFIG_LAYOUT_KEY = 'axf.skinConfig.layout';
export const SKIN_CONFIG_TAB = 'skin-config';
export type SkinConfigLayout = 'tree' | 'columns' | 'chips';
type Mode = 'allow' | 'lock' | 'ask';

interface Opt { id: string; label: string; kind: string }
interface Group { id: string; label: string; kind: string; options: Opt[] }
interface Limit { id: string; label: string; min: number; max: number; default: number }
interface Category { type: string; label: string; section: string; by: string; groups: Group[]; limits: Limit[] }
interface Tree { categories: Category[] }
interface State {
  app: string; default: Mode; counts: Record<Mode, number>; limits: Record<string, number>;
  options: Record<string, { mode: Mode; from: string }>;
  defaultSkin: { id: string; derived: boolean; name?: string; error?: string } | null;
}
interface Made { id: string; at: string; status: string; wish?: string; skin?: string; error?: string; applied?: { what: string }[]; droppedLines?: string[] }
export interface SkinConfigService {
  tree(): Promise<unknown>; get(app: string): Promise<unknown>;
  set(app: string, path: string, mode: Mode | 'inherit'): Promise<unknown>;
  depth(app: string, type: string, value: number | 'default', limit?: string): Promise<unknown>;
  mode(app: string, mode: Mode): Promise<unknown>; reset(app: string): Promise<unknown>;
  saveDefault(app: string): Promise<unknown>; make(app: string, wish?: string): Promise<unknown>;
  made(app: string): Promise<{ items: unknown[] }>;
}

export const skinConfigService = (): SkinConfigService | null => {
  const s = (globalThis as { __axfWebServices?: Record<string, unknown> }).__axfWebServices?.[SKIN_CONFIG_SERVICE] as SkinConfigService | undefined;
  return s && typeof s.get === 'function' ? s : null;
};

export const SKIN_CONFIG_CHOICES = 'ui-choices:skin-config';
const LAYOUT_NAMES: Record<SkinConfigLayout, string> = { tree: 'Tree', columns: 'Two columns', chips: 'Chips' };
/** The layouts the registered settings assets offer (`ui-choices:skin-config`), else the three built in. */
function layoutOptions(rt: AxfRuntime): { value: SkinConfigLayout; label: string }[] {
  const views = rt.registry.list('settings').filter((a) => a.tags?.includes(SKIN_CONFIG_CHOICES)).map((a) => (a.data as { view?: string }).view).filter((v): v is SkinConfigLayout => v === 'tree' || v === 'columns' || v === 'chips');
  const list = views.length ? [...new Set(views)] : (Object.keys(LAYOUT_NAMES) as SkinConfigLayout[]);
  return list.map((v) => ({ value: v, label: LAYOUT_NAMES[v] }));
}
const MODES: { value: Mode; label: string }[] = [
  { value: 'allow', label: 'Allow' },
  { value: 'lock', label: 'Lock' },
  { value: 'ask', label: 'Ask' },
];
export function skinConfigLayout(rt: AxfRuntime): SkinConfigLayout {
  const v = rt.settings.get(SKIN_CONFIG_LAYOUT_KEY);
  return v === 'columns' || v === 'chips' ? v : 'tree';
}

/** The modes of every option under a node: all allowed = on, none = off, a mix = some. */
function nodeState(state: State, type: string, group?: Group, cat?: Category): 'on' | 'off' | 'some' {
  const paths = group ? group.options.map((o) => `${type}/${group.id}/${o.id}`) : (cat?.groups ?? []).flatMap((g) => g.options.map((o) => `${type}/${g.id}/${o.id}`));
  const allowed = paths.filter((p) => state.options[p]?.mode === 'allow').length;
  return allowed === paths.length ? 'on' : allowed === 0 ? 'off' : 'some';
}

export function SkinConfigPanel() {
  const rt = useRuntime();
  const svc = skinConfigService();
  const [level, setLevel] = useState<'app' | 'global'>('app');
  const app = level === 'global' ? 'global' : rt.manifest.app.id;
  const [tree, setTree] = useState<Tree | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [made, setMade] = useState<Made[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState('all');
  const [filter, setFilter] = useState('');
  const [wish, setWish] = useState('');
  const [picked, setPicked] = useState('');
  const [layout, setLayoutState] = useState<SkinConfigLayout>(() => skinConfigLayout(rt));
  useEffect(() => rt.settings.onChange(SKIN_CONFIG_LAYOUT_KEY, () => setLayoutState(skinConfigLayout(rt))), [rt]);

  const load = useCallback(() => {
    if (!svc) return;
    setError('');
    Promise.all([svc.tree(), svc.get(app), svc.made(app)])
      .then(([t, s, m]) => { setTree(t as Tree); setState(s as State); setMade((m.items ?? []) as Made[]); })
      .catch((e: Error) => setError(e.message));
  }, [svc, app]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const on = () => load(); globalThis.addEventListener?.('axf:skin-config', on); return () => globalThis.removeEventListener?.('axf:skin-config', on); }, [load]);

  const run = (p: Promise<unknown> | undefined) => {
    if (!p) return;
    setBusy(true);
    p.then((s) => { if (s && typeof s === 'object' && 'options' in (s as object)) setState(s as State); else load(); }, (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  const setMode = (path: string, on: boolean) => run(svc?.set(app, path, on ? 'allow' : 'lock'));
  const setDepth = (type: string, limit: string, v: number) => run(svc?.depth(app, type, v, limit));

  const sections = useMemo(() => [...new Set((tree?.categories ?? []).map((c) => c.section))], [tree]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (tree?.categories ?? []).filter((c) => (section === 'all' || c.section === section) && (!q || c.label.toLowerCase().includes(q) || c.type.includes(q) || c.groups.some((g) => g.options.some((o) => o.label.toLowerCase().includes(q)))));
  }, [tree, section, filter]);

  if (!svc) return <Note>Nothing in this app provides the skin config ({SKIN_CONFIG_SERVICE}). On the Dev Console it comes with the Theme manager plugin.</Note>;
  if (error && !state) return <Note tone="danger">{error}</Note>;
  if (!tree || !state) return <p className="fx-muted">Loading the skin config…</p>;

  const limitRow = (c: Category) => c.limits.map((l) => {
    const v = state.limits[`${c.type}/${l.id}`] ?? l.default;
    return (
      <div key={l.id} className="axf-skincfg__limit" role="group" aria-label={`${c.label}: ${l.label}`}>
        <span className="axf-skincfg__limitlabel">{l.label}</span>
        <Button size="sm" tone="ghost" icon="minus" aria-label={`Fewer: ${l.label}`} disabled={busy || v <= l.min} onClick={() => setDepth(c.type, l.id, v - 1)} />
        <span className="axf-skincfg__limitvalue" aria-live="polite">{v}</span>
        <Button size="sm" tone="ghost" icon="plus" aria-label={`More: ${l.label}`} disabled={busy || v >= l.max} onClick={() => setDepth(c.type, l.id, v + 1)} />
      </div>
    );
  });
  const optionRows = (c: Category) => c.groups.map((g) => {
    const gs = nodeState(state, c.type, g);
    return (
      <div key={g.id} className="axf-skincfg__group">
        <Switch label={g.label} checked={gs === 'on'} text={gs === 'some' ? 'Some' : undefined} disabled={busy} onChange={(v) => setMode(`${c.type}/${g.id}`, v)} />
        <div className="axf-skincfg__options">
          {g.options.map((o) => {
            const m = state.options[`${c.type}/${g.id}/${o.id}`]?.mode ?? state.default;
            return (
              <div key={o.id} className="axf-skincfg__option">
                <Switch label={o.label} checked={m === 'allow'} disabled={busy} onChange={(v) => setMode(`${c.type}/${g.id}/${o.id}`, v)} />
                {m === 'ask' && <Chip tone="warning">Ask</Chip>}
              </div>
            );
          })}
        </div>
      </div>
    );
  });
  const catSwitch = (c: Category) => {
    const cs = nodeState(state, c.type, undefined, c);
    return <Switch label={`AI may change ${c.label.toLowerCase()}`} hideLabel checked={cs === 'on'} text={cs === 'some' ? 'Some' : cs === 'on' ? 'Allowed' : 'Locked'} disabled={busy} onChange={(v) => setMode(c.type, v)} />;
  };

  const body = layout === 'chips' ? (
    <div className="axf-skincfg__chips" role="group" aria-label="Categories the AI may change">
      {shown.map((c) => {
        const cs = nodeState(state, c.type, undefined, c);
        return <Button key={c.type} size="sm" tone={cs === 'on' ? 'primary' : cs === 'some' ? 'neutral' : 'quiet'} icon={cs === 'on' ? 'check' : cs === 'some' ? 'minus' : 'lock'} aria-pressed={cs === 'on'} title={`${c.label}: ${cs === 'on' ? 'the AI may change it' : cs === 'some' ? 'partly allowed' : 'locked'}`} disabled={busy} onClick={() => setMode(c.type, cs !== 'on')}>{c.label}</Button>;
      })}
      {shown.some((c) => c.limits.length > 0) && <div className="axf-skincfg__limits">{shown.filter((c) => c.limits.length).map((c) => <div key={c.type}>{limitRow(c)}</div>)}</div>}
    </div>
  ) : layout === 'columns' ? (() => {
    const cur = shown.find((c) => c.type === picked) ?? shown[0];
    return (
      <div className="axf-skincfg__columns">
        <div className="axf-skincfg__catlist" role="listbox" aria-label="Categories">
          {shown.map((c) => {
            const cs = nodeState(state, c.type, undefined, c);
            return <Button key={c.type} size="sm" tone={cur?.type === c.type ? 'primary' : 'ghost'} icon={cs === 'on' ? 'check' : cs === 'some' ? 'minus' : 'lock'} role="option" aria-selected={cur?.type === c.type} onClick={() => setPicked(c.type)}>{c.label}</Button>;
          })}
        </div>
        {cur && (
          <Container title={cur.label} icon="sliders" actions={catSwitch(cur)}>
            {limitRow(cur)}
            {optionRows(cur)}
          </Container>
        )}
      </div>
    );
  })() : (
    <div className="axf-skincfg__tree">
      {shown.map((c) => (
        <Container key={c.type} title={c.label} icon="sliders" collapsible defaultOpen={false} actions={catSwitch(c)}>
          {limitRow(c)}
          {optionRows(c)}
        </Container>
      ))}
    </div>
  );

  const last = made[0];
  return (
    <div className="axf-skincfg">
      {error && <Note tone="danger">{error}</Note>}
      <div className="axf-skincfg__bar" role="toolbar" aria-label="Skin config">
        <Segmented label="Level" size="sm" value={level} options={[{ value: 'app', label: 'This app' }, { value: 'global', label: 'Hub-wide' }]} onChange={setLevel} />
        <Segmented label="Layout" size="sm" value={layout} options={layoutOptions(rt)} onChange={(v) => rt.settings.set(SKIN_CONFIG_LAYOUT_KEY, v)} />
        <Button size="sm" tone="ghost" icon="refresh" confirm="Reset the skin config? The AI may change everything again." disabled={busy} onClick={() => run(svc.reset(app))}>Reset</Button>
      </div>
      <div className="axf-skincfg__row">
        <span className="axf-skincfg__label">Everything not set</span>
        <Segmented label="Everything not set" size="sm" value={state.default} options={MODES} onChange={(m) => run(svc.mode(app, m))} />
        <Chip tone="success">{state.counts.allow} allowed</Chip>
        <Chip>{state.counts.lock} locked</Chip>
        {state.counts.ask > 0 && <Chip tone="warning">{state.counts.ask} ask</Chip>}
      </div>
      <div className="axf-skincfg__row">
        <span className="axf-skincfg__label">Default skin</span>
        <span className="axf-skincfg__value">{state.defaultSkin?.id ? `${state.defaultSkin.name ?? 'Default'} (${state.defaultSkin.id})${state.defaultSkin.derived ? ', not saved yet' : ''}` : state.defaultSkin?.error ?? 'none'}</span>
        <Button size="sm" icon="save" disabled={busy} onClick={() => run(svc.saveDefault(app))}>Save current look as Default</Button>
      </div>
      <div className="axf-skincfg__row axf-skincfg__make">
        <TextField label="What should the AI make?" value={wish} onChange={setWish} placeholder="calmer, darker, rounder buttons…" className="axf-skincfg__wish" />
        <Button tone="primary" icon="sparkles" busy={busy} disabled={busy} onClick={() => run(svc.make(app, wish))}>Make skin with AI</Button>
      </div>
      {last && (
        <Note tone={last.status === 'failed' ? 'danger' : last.droppedLines?.length ? 'warning' : 'success'}>
          {last.status === 'failed' ? `The last AI skin failed: ${last.error ?? ''}` : `Last AI skin ${last.skin ?? last.id}: ${last.applied?.length ?? 0} change${last.applied?.length === 1 ? '' : 's'} applied${last.droppedLines?.length ? `, ${last.droppedLines.length} dropped: ${last.droppedLines.slice(0, 4).join('; ')}${last.droppedLines.length > 4 ? '…' : ''}` : ''}.`}
        </Note>
      )}
      <TabGroup id="axf.skinConfig.sections" label="Skin config sections" value={section} onChange={setSection} tabs={[{ value: 'all', label: 'All' }, ...sections.map((s) => ({ value: s, label: s }))]} />
      <TextField label="Find an option" value={filter} onChange={setFilter} placeholder="colours, context menu, radius…" />
      {body}
    </div>
  );
}

export const SKIN_CONFIG_CSS = `
.axf-skincfg{display:flex;flex-direction:column;gap:var(--fx-dens-gap-lg)}
.axf-skincfg__bar,.axf-skincfg__row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--fx-dens-gap-md)}
.axf-skincfg__label{font-weight:600;font-size:var(--fx-type-scale-sm)}
.axf-skincfg__value{flex:1 1 auto;min-width:0;font-size:var(--fx-type-scale-sm);color:var(--fx-muted)}
.axf-skincfg__make{align-items:flex-end}
.axf-skincfg__wish{flex:1 1 calc(var(--fx-font-size)*16);min-width:0}
.axf-skincfg__tree{display:flex;flex-direction:column;gap:var(--fx-dens-gap-md)}
.axf-skincfg__group{display:flex;flex-direction:column;gap:var(--fx-dens-gap-xs);padding-block:var(--fx-dens-gap-sm);border-bottom:var(--fx-border-w) solid var(--fx-border)}
.axf-skincfg__options{display:flex;flex-direction:column;gap:var(--fx-dens-gap-xs);padding-inline-start:var(--fx-dens-gap-2xl)}
.axf-skincfg__option{display:flex;align-items:center;gap:var(--fx-dens-gap-sm)}
.axf-skincfg__limit{display:flex;align-items:center;gap:var(--fx-dens-gap-sm);padding-block:var(--fx-dens-gap-xs)}
.axf-skincfg__limitlabel{flex:1 1 auto;min-width:0;font-size:var(--fx-type-scale-sm)}
.axf-skincfg__limitvalue{min-width:calc(var(--fx-font-size)*2);text-align:center;font-weight:600}
.axf-skincfg__columns{display:grid;grid-template-columns:minmax(calc(var(--fx-font-size)*12),1fr) 3fr;gap:var(--fx-dens-gap-lg);align-items:start}
.axf-skincfg__catlist{display:flex;flex-direction:column;gap:var(--fx-dens-gap-xs);max-height:calc(var(--fx-font-size)*36);overflow:auto}
.axf-skincfg__catlist>*{justify-content:flex-start}
.axf-skincfg__chips{display:flex;flex-wrap:wrap;gap:var(--fx-dens-gap-sm)}
.axf-skincfg__limits{flex:1 1 100%;display:flex;flex-direction:column;gap:var(--fx-dens-gap-xs)}
:where([data-fx-small]) .axf-skincfg__columns{grid-template-columns:1fr}
:where([data-fx-small]) .axf-skincfg__catlist{flex-direction:row;flex-wrap:wrap;max-height:none}
`;
