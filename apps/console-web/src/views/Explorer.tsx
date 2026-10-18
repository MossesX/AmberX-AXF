import { useState } from 'react';
import { Button, Chip, Container, Icon, Slider, useAsset, useAxfState, useRuntime, useWindowManager, useWindowSpec, type TabRenderers } from '../axf/react';
import type { AssetType, AssetEnvelope } from '../axf/core';
import { useStore } from '../store';
import { UI_LIBRARIES } from './Libraries';

/* ------------------------------------------------------------------ */
/* element catalog (mirrors axf-ui/studio/ElementExplorer.kt)           */
/* ------------------------------------------------------------------ */

export interface StyleParam { key: string; label: string; tip: string; type: AssetType; path: string[]; kind: 'number' | 'enum' | 'text'; min?: number; max?: number; options?: string[] }
export interface FlagSpec { key: string; label: string; tip: string; type: AssetType; path: string[] }
export interface ElementSpec { kind: string; label: string; category: string; tooltip: string; tokens: [string, string][]; params: StyleParam[]; flags: FlagSpec[] }

const p = (key: string, label: string, tip: string, type: AssetType, path: string[], kind: StyleParam['kind'] = 'number', min = 0, max = 100, options?: string[]): StyleParam => ({ key, label, tip, type, path, kind, min, max, options });
const f = (key: string, label: string, tip: string, type: AssetType, path: string[]): FlagSpec => ({ key, label, tip, type, path });
const radius = [p('radius.sm', 'Radius sm', 'Small corner radius (style-theme)', 'style-theme', ['radius', 'sm'], 'number', 0, 24), p('radius.md', 'Radius md', 'Medium corner radius', 'style-theme', ['radius', 'md'], 'number', 0, 32), p('radius.lg', 'Radius lg', 'Large corner radius', 'style-theme', ['radius', 'lg'], 'number', 0, 48)];
const spacing = [p('space', 'Spacing unit', 'Base spacing unit; every padding is a multiple', 'style-theme', ['space'], 'number', 4, 16), p('density', 'Density', 'compact / comfortable / spacious scales row heights and paddings', 'style-theme', ['density'], 'enum', 0, 0, ['compact', 'comfortable', 'spacious'])];
const type = [p('fontSize', 'Font size', 'Base font size (px)', 'style-theme', ['fontSize'], 'number', 10, 20), p('headingWeight', 'Heading weight', 'Font weight of headings', 'style-theme', ['headingWeight'], 'number', 300, 900)];
const E = (kind: string, label: string, category: string, tooltip: string, tokens: [string, string][], params: StyleParam[] = [], flags: FlagSpec[] = []): ElementSpec => ({ kind, label, category, tooltip, tokens, params, flags });

/** The element catalog: what each kind reads. Mirrors the Android explorer so compare windows show the same tree on every port. */
export const ELEMENTS: ElementSpec[] = [
  E('BUTTON', 'Button', 'Controls', 'Primary / neutral / danger / ghost buttons from the button asset', [['accent', 'Primary fill'], ['accentText', 'Text on primary'], ['surface2', 'Neutral fill'], ['border', 'Outline'], ['danger', 'Danger fill'], ['text', 'Neutral text']],
    [p('shape', 'Shape', 'rounded / pill / square', 'button', ['shape'], 'enum', 0, 0, ['rounded', 'pill', 'square']), p('fill', 'Fill', 'solid / soft / outline / gradient', 'button', ['fill'], 'enum', 0, 0, ['solid', 'soft', 'outline', 'gradient']), p('size', 'Size', 'sm / md / lg', 'button', ['size'], 'enum', 0, 0, ['sm', 'md', 'lg']), ...radius.slice(0, 2)],
    [f('elevation', 'Elevation', 'Drop shadow under buttons', 'button', ['elevation']), f('uppercase', 'Uppercase labels', 'Uppercase with tracking', 'button', ['uppercase'])]),
  E('ICON_BUTTON', 'Icon button', 'Controls', 'Square icon-only button', [['muted', 'Icon tint'], ['accentSoft', 'Active background']], radius.slice(0, 1)),
  E('SWITCH', 'Switch', 'Controls', 'On/off toggle with label', [['accent', 'On track'], ['surface3', 'Off track'], ['accentText', 'Thumb on']]),
  E('CHECKBOX', 'Checkbox', 'Controls', 'Checkbox with label', [['accent', 'Checked'], ['border', 'Unchecked border']]),
  E('CHIP', 'Chip', 'Controls', 'Filter / tone chips', [['accentSoft', 'Selected fill'], ['accent', 'Selected text'], ['border', 'Outline']], radius.slice(0, 1)),
  E('SEGMENTED', 'Segmented', 'Controls', 'Segmented control', [['surface2', 'Track'], ['surface', 'Selected segment'], ['accent', 'Selected text']], radius.slice(1, 2)),
  E('SLIDER', 'Slider', 'Controls', 'Slider from the slider asset', [['accent', 'Active track'], ['surface3', 'Inactive track']],
    [p('thumb', 'Thumb', 'round / square / bar', 'slider', ['thumb'], 'enum', 0, 0, ['round', 'square', 'bar']), p('trackHeight', 'Track height', 'px', 'slider', ['trackHeight'], 'number', 2, 16)],
    [f('showValue', 'Show value', 'Value label next to the slider', 'slider', ['showValue']), f('ticks', 'Ticks', 'Tick marks along the track', 'slider', ['ticks'])]),
  E('TEXT_FIELD', 'Text field', 'Inputs', 'Single/multi-line input', [['surface', 'Field background'], ['border', 'Outline'], ['focus', 'Focus ring'], ['placeholder', 'Placeholder']], [...radius.slice(0, 1), p('borderWidth', 'Border width', 'px', 'style-theme', ['borderWidth'], 'number', 0, 4)]),
  E('PASSWORD_FIELD', 'Password field', 'Inputs', 'Masked input with reveal', [['surface', 'Field background'], ['muted', 'Reveal icon']]),
  E('SEARCH_FIELD', 'Search field', 'Inputs', 'Toolbar search', [['surface2', 'Field background'], ['muted', 'Icon']]),
  E('CARD', 'Card / container', 'Containers', 'Card from the container asset', [['surface', 'Card fill'], ['border', 'Card border'], ['shadow', 'Shadow']],
    [p('style', 'Style', 'card / panel / glass / outline', 'container', ['style'], 'enum', 0, 0, ['card', 'panel', 'glass', 'outline']), p('padding', 'Padding', 'multiple of the spacing unit', 'container', ['padding'], 'number', 0, 4), ...radius.slice(1, 3), ...spacing],
    [f('divider', 'Header divider', 'Rule under the header', 'container', ['headerDivider']), f('collapsible', 'Collapsible', 'Header toggles the body', 'container', ['collapsible'])]),
  E('LIST_ITEM', 'List item', 'Containers', 'Row with icon, title, subtitle, trailing', [['text', 'Title'], ['muted', 'Subtitle'], ['accentSoft', 'Selected']], spacing),
  E('SECTION_HEADER', 'Section header', 'Containers', 'Uppercase eyebrow', [['muted', 'Text'], ['accent', 'Accent variant']], type.slice(1)),
  E('BADGE', 'Badge', 'Containers', 'Small pill', [['surface3', 'Fill'], ['muted', 'Text']]),
  E('DIVIDER', 'Divider', 'Containers', '1px rule', [['divider', 'Color']]),
  E('MENUBAR', 'Menubar', 'Navigation', 'App menu from the app-menu asset', [['surface', 'Bar'], ['text', 'Items'], ['accentSoft', 'Open menu']]),
  E('TOOLBAR', 'Toolbar', 'Navigation', 'Toolbar from the toolbar asset', [['toolbarBg', 'Bar'], ['muted', 'Icons']], [p('iconSize', 'Icon size', 'px', 'toolbar', ['iconSize'], 'number', 14, 28)], [f('labels', 'Labels', 'Text under icons', 'toolbar', ['showLabels'])]),
  E('NAV_LIST', 'Navigation', 'Navigation', 'Nav from the nav-menu asset', [['navBg', 'Background'], ['navText', 'Items'], ['navActive', 'Active item']]),
  E('STATUS_BAR', 'Status bar', 'Navigation', 'Bottom status strip', [['statusBg', 'Background'], ['muted', 'Text']]),
  E('DIALOG', 'Dialog', 'Overlays', 'Dialog from the dialog asset', [['surface', 'Panel'], ['scrim', 'Backdrop']], [p('position', 'Position', 'center / top / bottom / side', 'dialog', ['position'], 'enum', 0, 0, ['center', 'top', 'bottom', 'side']), ...radius.slice(2, 3)], [f('blur', 'Backdrop blur', 'Blur behind the dialog', 'dialog', ['backdropBlur'])]),
  E('TOAST', 'Toast', 'Overlays', 'Toasts from the popup asset', [['inverseSurface', 'Toast'], ['inverseText', 'Text']], [p('corner', 'Corner', 'where toasts stack', 'popup', ['corner'], 'enum', 0, 0, ['top-right', 'bottom-right', 'bottom-left', 'top-left', 'top', 'bottom'])]),
  E('CONTEXT_MENU', 'Context menu', 'Overlays', 'Right-click / long-press menu from the context-menu asset', [['surface', 'Menu'], ['accentSoft', 'Hover']], [p('density', 'Density', 'compact / comfortable', 'context-menu', ['density'], 'enum', 0, 0, ['compact', 'comfortable'])], [f('icons', 'Show icons', '', 'context-menu', ['showIcons']), f('shortcuts', 'Show shortcuts', '', 'context-menu', ['showShortcuts'])]),
  E('EMPTY_STATE', 'Empty state', 'States', 'Empty / loading / error blocks', [['muted', 'Text'], ['surface2', 'Icon well']]),
  E('PROGRESS', 'Progress', 'States', 'Indeterminate progress', [['accent', 'Bar'], ['surface3', 'Track']]),
  E('TABLE', 'Table', 'Data & media', 'Data grid (library)', [['border', 'Grid lines'], ['surface2', 'Header']]),
  E('CHART', 'Chart', 'Data & media', 'Charts (library)', [['chart1', 'Series 1'], ['chart2', 'Series 2'], ['chart3', 'Series 3']]),
  E('MEDIA_PLAYER', 'Media player', 'Data & media', 'Video/audio player (library)', [['accent', 'Scrubber'], ['overlay', 'Controls overlay']]),
  E('MAP', 'Map', 'Data & media', 'Map view (library)', [['accent', 'Markers'], ['surface', 'Attribution']]),
];
export const CATEGORIES = [...new Set(ELEMENTS.map((e) => e.category))];

/** Which kinds each kit covers (web port: everything the AXF kit renders; ported Android kits: from their library.json). */
function coversFor(kitId: string, store: ReturnType<typeof useStore>): Set<string> | null {
  if (kitId === 'axf' || kitId === 'material3') return null; // covers everything
  const lib = store.libraries.find((l) => l.module === `kit-${kitId}`);
  if (lib?.port?.covers) return new Set(lib.port.covers);
  if (kitId === 'unstyled') return new Set(['BUTTON', 'ICON_BUTTON', 'SWITCH', 'CHECKBOX', 'CHIP', 'BADGE', 'SECTION_HEADER', 'DIVIDER']);
  return null;
}

/* ------------------------------------------------------------------ */
/* hot-swap editing: derive a `<id>-custom` asset and swap to it        */
/* ------------------------------------------------------------------ */

function useEditor() {
  const rt = useRuntime();
  return (type: AssetType, path: string[], value: unknown) => {
    const cur = rt.asset(type) as AssetEnvelope;
    const id = cur.id.endsWith('-custom') ? cur.id : `${cur.id}-custom`;
    const data = JSON.parse(JSON.stringify(cur.data)) as Record<string, unknown>;
    let o: Record<string, unknown> = data;
    for (const k of path.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
    o[path[path.length - 1]!] = value;
    const next = { ...cur, id, name: cur.name.endsWith(' (edited)') ? cur.name : `${cur.name} (edited)`, data } as AssetEnvelope;
    const r = rt.importAsset(next, true);
    if (!r.ok) rt.toast(r.errors.join('; '), 'danger', 'Edit rejected');
    else rt.terminal.log('hot-swap', `${type}.${path.join('.')} = ${JSON.stringify(value)} → ${id}`);
  };
}
const getPath = (data: unknown, path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), data);

/* ------------------------------------------------------------------ */
/* tree                                                                */
/* ------------------------------------------------------------------ */

/** Categorized collapsible tree of elements → tokens / style parameters / flags, with tooltips; greyed if the kit lacks the kind; edits hot-swap. */
export function ElementExplorer({ kitId }: { kitId: string }) {
  const spec = useWindowSpec();
  const store = useStore();
  const covers = coversFor(kitId, store);
  const [open, setOpen] = useState<Set<string>>(new Set(CATEGORIES.slice(0, 2)));
  const [sel, setSel] = useState<string>('BUTTON');
  useAxfState();
  if (spec?.mode === 'grid') return <ElementGrid kitId={kitId} covers={covers} />;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const cur = ELEMENTS.find((e) => e.kind === sel)!;
  return (
    <div className="cx-explorer">
      <div className="cx-explorer__tree">
        <div className="fx-muted fx-small" style={{ padding: '4px 6px' }}>Kit <span className="fx-mono">{kitId}</span> · {ELEMENTS.length} elements · drag an element or category to undock it</div>
        {CATEGORIES.map((c) => { const items = ELEMENTS.filter((e) => e.category === c); return (
          <div key={c}>
            <div className="cx-node cx-node--cat" title={`${items.length} elements`} draggable onDragStart={(e) => e.dataTransfer.setData('text/axf-undock', JSON.stringify({ kind: 'element-category', payload: c, title: c, kitId }))} onClick={() => toggle(c)}><Icon name={open.has(c) ? 'chevron-down' : 'chevron-right'} /> {c} <span className="fx-badge">{items.length}</span></div>
            {open.has(c) && items.map((e) => { const ok = !covers || covers.has(e.kind); return (
              <div key={e.kind} className={`cx-node cx-node--el ${sel === e.kind ? 'is-selected' : ''} ${ok ? '' : 'is-disabled'}`} title={ok ? e.tooltip : `${e.tooltip} — not available in kit ${kitId} (falls back to the default kit)`} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/axf-undock', JSON.stringify({ kind: 'element', payload: e.kind, title: e.label, kitId }))} onClick={() => setSel(e.kind)}>
                <Icon name="box" /> {e.label} <span className="fx-muted fx-small">{e.tokens.length}t · {e.params.length}p · {e.flags.length}f</span>
              </div>); })}
          </div>); })}
      </div>
      <div className="cx-explorer__detail">
        <ElementPreview kind={cur.kind} />
        <ElementDetails e={cur} available={!covers || covers.has(cur.kind)} />
      </div>
    </div>
  );
}

function ElementDetails({ e, available }: { e: ElementSpec; available: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set(['tokens', 'params', 'flags']));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className={`cx-details ${available ? '' : 'is-disabled'}`}>
      {!available && <p className="fx-muted fx-small">Not available in this kit — the app falls back to the default AmberX kit for {e.label}.</p>}
      <div className="cx-node cx-node--cat" onClick={() => toggle('tokens')} title="Color tokens this element reads"><Icon name={open.has('tokens') ? 'chevron-down' : 'chevron-right'} /> Tokens <span className="fx-badge">{e.tokens.length}</span></div>
      {open.has('tokens') && e.tokens.map(([tok, what]) => <TokenRow key={tok} token={tok} what={what} available={available} />)}
      <div className="cx-node cx-node--cat" onClick={() => toggle('params')} title="Style parameters (asset fields) this element reads"><Icon name={open.has('params') ? 'chevron-down' : 'chevron-right'} /> Style parameters <span className="fx-badge">{e.params.length}</span></div>
      {open.has('params') && e.params.map((pr) => <ParamRow key={pr.key} p={pr} available={available} />)}
      <div className="cx-node cx-node--cat" onClick={() => toggle('flags')} title="Element options / flags (on/off at their default state)"><Icon name={open.has('flags') ? 'chevron-down' : 'chevron-right'} /> Element options / flags <span className="fx-badge">{e.flags.length}</span></div>
      {open.has('flags') && e.flags.map((fl) => <FlagRow key={fl.key} f={fl} available={available} />)}
      {open.has('flags') && e.flags.length === 0 && <div className="fx-muted fx-small" style={{ padding: '2px 24px' }}>No flags.</div>}
    </div>
  );
}

function TokenRow({ token, what, available }: { token: string; what: string; available: boolean }) {
  const theme = useAsset('color-theme');
  const edit = useEditor();
  const value = (theme.data.tokens as Record<string, string>)[token] ?? '';
  return (
    <div className="cx-row" title={`${what} — color-theme token "${token}" (${value || 'derived'})`}>
      <span className="cx-swatch" style={{ background: value ? `var(--fx-${token.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())})` : 'transparent' }} />
      <span className="fx-grow">{what} <span className="fx-muted fx-mono fx-small">{token}</span></span>
      {available && value ? <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#888888' /* theme-ok: data value */} onChange={(e) => edit('color-theme', ['tokens', token], e.target.value)} /> : <span className="fx-muted fx-small">{value ? '—' : 'derived'}</span>}
    </div>
  );
}

function ParamRow({ p, available }: { p: StyleParam; available: boolean }) {
  const rt = useRuntime();
  const edit = useEditor();
  const cur = getPath(rt.asset(p.type).data, p.path);
  return (
    <div className="cx-row" title={`${p.tip} — ${p.type}.${p.path.join('.')}`}>
      <span className="fx-grow">{p.label} <span className="fx-muted fx-mono fx-small">{p.type}.{p.path.join('.')}</span></span>
      {!available || cur === undefined ? <span className="fx-muted fx-small">{cur === undefined ? 'n/a' : String(cur)}</span>
        : p.kind === 'enum' ? <select className="fx-input" value={String(cur)} onChange={(e) => edit(p.type, p.path, e.target.value)}>{p.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        : p.kind === 'number' ? <span style={{ width: 160 }}><Slider label="" value={Number(cur)} min={p.min} max={p.max} onChange={(v) => edit(p.type, p.path, v)} /></span>
        : <input className="fx-input" value={String(cur)} onChange={(e) => edit(p.type, p.path, e.target.value)} />}
    </div>
  );
}

function FlagRow({ f, available }: { f: FlagSpec; available: boolean }) {
  const rt = useRuntime();
  const edit = useEditor();
  const cur = getPath(rt.asset(f.type).data, f.path);
  return (
    <div className="cx-row" title={`${f.tip || f.label} — ${f.type}.${f.path.join('.')} (default ${String(cur ?? 'off')})`}>
      <span className="fx-grow">{f.label} <span className="fx-muted fx-mono fx-small">{f.type}.{f.path.join('.')}</span></span>
      <label className="cx-switch"><input type="checkbox" disabled={!available} checked={!!cur} onChange={(e) => edit(f.type, f.path, e.target.checked)} /><span /></label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* preview                                                             */
/* ------------------------------------------------------------------ */

/** Renders one element kind with the web port's real components (so edits hot-swap the preview). */
export function ElementPreview({ kind }: { kind: string }) {
  const rt = useRuntime();
  useAxfState();
  const [v, setV] = useState(40);
  const body = (() => {
    switch (kind) {
      case 'BUTTON': return <div className="fx-row fx-row--wrap"><Button tone="primary" icon="zap">Primary</Button><Button>Neutral</Button><Button tone="danger" icon="trash">Danger</Button><Button tone="ghost">Ghost</Button></div>;
      case 'ICON_BUTTON': return <div className="fx-row"><button className="fx-iconbtn"><Icon name="settings" /></button><button className="fx-iconbtn is-active"><Icon name="star" /></button></div>;
      case 'SWITCH': return <label className="cx-switch"><input type="checkbox" defaultChecked /><span /> On</label>;
      case 'CHECKBOX': return <label><input type="checkbox" defaultChecked /> Checked</label>;
      case 'CHIP': return <div className="fx-row fx-row--wrap"><Chip>neutral</Chip><Chip tone="accent">accent</Chip><Chip tone="success">success</Chip><Chip tone="warning">warning</Chip><Chip tone="danger">danger</Chip></div>;
      case 'SEGMENTED': return <div className="fx-row"><button className="fx-chip is-selected">One</button><button className="fx-chip">Two</button><button className="fx-chip">Three</button></div>;
      case 'SLIDER': return <Slider label="Volume" value={v} onChange={setV} unit="%" />;
      case 'TEXT_FIELD': return <input className="fx-input" placeholder="Type here…" />;
      case 'PASSWORD_FIELD': return <input className="fx-input" type="password" defaultValue="secret" />;
      case 'SEARCH_FIELD': return <div className="fx-search"><Icon name="search" /><input placeholder="Search" /></div>;
      case 'CARD': return <Container title="Card" icon="box"><p style={{ margin: 0 }}>Card body from the container asset.</p></Container>;
      case 'LIST_ITEM': return <div className="cx-item"><Icon name="file" /><div className="fx-grow">Title<div className="fx-muted fx-small">Subtitle</div></div><Chip>trailing</Chip></div>;
      case 'SECTION_HEADER': return <p className="fx-eyebrow">Section header</p>;
      case 'BADGE': return <span className="fx-badge">badge</span>;
      case 'DIVIDER': return <hr />;
      case 'DIALOG': return <Button icon="external" onClick={() => rt.openDialog('about')}>Open a dialog</Button>;
      case 'TOAST': return <Button icon="bell" onClick={() => rt.toast('Hello from the preview', 'success', 'Toast')}>Show toast</Button>;
      case 'CONTEXT_MENU': return <div className="fx-empty" data-fx-ctx-target="canvas">Right-click here</div>;
      case 'EMPTY_STATE': return <div className="fx-empty">Nothing here yet</div>;
      case 'PROGRESS': return <div className="cx-progress"><span /></div>;
      case 'TABLE': return <table className="fx-table"><tbody><tr><th>Name</th><td>Value</td></tr><tr><th>Other</th><td>Value</td></tr></tbody></table>;
      case 'CHART': return <div className="cx-chart">{[40, 70, 55, 90, 30].map((h, i) => <span key={i} style={{ height: `${h}%`, background: ['var(--fx-accent)', 'var(--fx-info)', 'var(--fx-success)'][i % 3] }} />)}</div>;
      default: return <div className="fx-empty">{kind} — rendered by a library kit</div>;
    }
  })();
  return <div className="cx-preview">{body}</div>;
}

/* ------------------------------------------------------------------ */
/* grid mode                                                           */
/* ------------------------------------------------------------------ */

/** Grid view: one expandable row per category → scrolling strip of element previews + sub-grid of flags/tokens/params for the visible element. */
function ElementGrid({ kitId, covers }: { kitId: string; covers: Set<string> | null }) {
  const [open, setOpen] = useState<Set<string>>(new Set(CATEGORIES.slice(0, 1)));
  const [visible, setVisible] = useState<Record<string, number>>({});
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="cx-grid">
      {CATEGORIES.map((c) => { const items = ELEMENTS.filter((e) => e.category === c); const idx = visible[c] ?? 0; const e = items[idx] ?? items[0]!; return (
        <div key={c} className="cx-grid__row">
          <div className="cx-node cx-node--cat" onClick={() => toggle(c)}><Icon name={open.has(c) ? 'chevron-down' : 'chevron-right'} /> {c} <span className="fx-badge">{items.length}</span><span className="fx-grow" /><span className="fx-muted fx-small">kit {kitId}</span></div>
          {open.has(c) && (
            <div className="cx-grid__body">
              <div className="cx-strip" onScroll={(ev) => { const el = ev.currentTarget; const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); if (i !== idx) setVisible((v) => ({ ...v, [c]: i })); }}>
                {items.map((it) => <div key={it.kind} className={`cx-strip__cell ${!covers || covers.has(it.kind) ? '' : 'is-disabled'}`}><div className="fx-muted fx-small">{it.label}</div><ElementPreview kind={it.kind} /></div>)}
              </div>
              <div className="fx-row fx-row--wrap" style={{ margin: '4px 0' }}>{items.map((it, i) => <button key={it.kind} className={`fx-chip ${i === idx ? 'is-selected' : ''}`} onClick={() => setVisible((v) => ({ ...v, [c]: i }))}>{it.label}</button>)}</div>
              <div className="cx-subgrid">
                {e.tokens.map(([tok, what]) => <div key={tok} className="cx-subgrid__cell"><TokenRow token={tok} what={what} available={!covers || covers.has(e.kind)} /></div>)}
                {e.params.map((pr) => <div key={pr.key} className="cx-subgrid__cell"><ParamRow p={pr} available={!covers || covers.has(e.kind)} /></div>)}
                {e.flags.map((fl) => <div key={fl.key} className="cx-subgrid__cell"><FlagRow f={fl} available={!covers || covers.has(e.kind)} /></div>)}
              </div>
            </div>)}
        </div>); })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab renderers for the windowing engine                              */
/* ------------------------------------------------------------------ */

export function LibraryInfoTab({ id }: { id: string }) {
  const rt = useRuntime();
  const l = UI_LIBRARIES.find((x) => x.id === id);
  if (!l) return <div className="fx-empty">Unknown library {id}</div>;
  return (
    <div className="fx-stack">
      <h3 style={{ margin: 0 }}>{l.name}</h3>
      <table className="fx-table"><tbody><tr><th>Vendor</th><td>{l.vendor}</td></tr><tr><th>Stack</th><td className="fx-mono">{l.stack}</td></tr><tr><th>Port</th><td>{l.port}</td></tr><tr><th>Status</th><td><Chip>{l.status}</Chip></td></tr><tr><th>Notes</th><td>{l.note}</td></tr></tbody></table>
      <p className="fx-muted fx-small">No AXF kit yet. Import it: the wizard clones the library, refactors it to AmberX tokens and saves it as a hot-swappable kit.</p>
      <div className="fx-row"><Button tone="primary" icon="download" onClick={() => rt.openDialog('uiimport', { source: l.id })}>Import as AmberX UI library</Button></div>
    </div>
  );
}

/** Drop target that turns a dragged tree node into its own floating ELEMENT window (toolbar off by default). */
export function useUndockDrop() {
  const wm = useWindowManager();
  return {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('text/axf-undock')) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData('text/axf-undock'); if (!raw) return;
      const d = JSON.parse(raw) as { kind: string; payload: string; title: string; kitId: string };
      wm.openFloating([{ id: `el-${Date.now().toString(36)}`, title: d.title, kind: d.kind, payload: `${d.kitId}|${d.payload}`, icon: 'box' }], d.title, 'element', 360, 320, e.clientX, e.clientY);
    },
  };
}

export const consoleTabs: TabRenderers = {
  'kit-preview': (t) => <ElementExplorer kitId={t.payload || 'axf'} />,
  'library-info': (t) => <LibraryInfoTab id={t.payload || ''} />,
  element: (t) => { const [, kind] = (t.payload || '|BUTTON').split('|'); const e = ELEMENTS.find((x) => x.kind === kind) ?? ELEMENTS[0]!; return <div className="fx-stack"><ElementPreview kind={e.kind} /><ElementDetails e={e} available /></div>; },
  'element-category': (t) => { const [, cat] = (t.payload || '|Controls').split('|'); return <div className="cx-grid">{ELEMENTS.filter((e) => e.category === cat).map((e) => <div key={e.kind} className="cx-strip__cell"><div className="fx-muted fx-small">{e.label}</div><ElementPreview kind={e.kind} /></div>)}</div>; },
};
