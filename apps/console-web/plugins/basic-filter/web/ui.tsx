/**
 * Basic filter — the UI: the applier + toolbar drawn above an attached dataset, the sort & filter dialog, the attach
 * list (used in this plugin's settings and in Plugin switches), and the toolbar designer with its live floating preview.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Button, ChoiceGrid, Icon, IconButton, Note, Segmented, SelectField, Switch, TextField, useRuntime,
} from '@console/axf/react';
import {
  clearDatasetTransform, DataGrid, datasetRowText, getDataset, getDatasetOrLast, knownDatasets, setDatasetTransform,
  useDatasetsRevision, type DatasetInfo, type GridColumn, type GridGroup,
} from '@console/axf/libs/datagrid';
import {
  actionFrom, DIALOG, distinct, EMPTY_STATE, makeCompare, makeFilter, newUid, OPS, OWNER, PRESETS, presetOf, ruleReady,
  stateActive, stateFilters, toggleSort, DEFAULT_TOOLBAR,
  type Display, type FilterState, type Preset, type Rule, type Tone, type ToolbarAction, type ToolbarConfig,
} from './core';
import { readState, saveState, saveToolbar, setAttached, useAttached, useFilterState, useToolbar } from './store';

/* ---------------- applying the filter to a dataset ---------------- */

/** Puts this dataset's saved filter on it while mounted; takes it off when unmounted, detached or the plugin is off. */
function useApplier(dataset: string, attached: boolean) {
  const s = useFilterState(dataset);
  const key = JSON.stringify(s);
  useEffect(() => {
    if (!attached || !stateActive(s)) { clearDatasetTransform(dataset, OWNER); return; }
    let cache: { ds: DatasetInfo<unknown> | null; filter: (r: unknown) => boolean; compare?: (a: unknown, b: unknown) => number } = { ds: null, filter: () => true };
    const fns = (ds: DatasetInfo<unknown>) => {
      if (cache.ds !== ds) cache = { ds, filter: makeFilter(s, ds.fields, (r) => datasetRowText(ds, r)), compare: makeCompare(s, ds.fields) };
      return cache;
    };
    setDatasetTransform<unknown>(dataset, OWNER, {
      label: 'Basic filter', active: stateFilters(s),
      ...(stateFilters(s) ? { filter: (r, ds) => fns(ds).filter(r) } : {}),
      ...(s.sort.length ? { compare: (a, b, ds) => fns(ds).compare?.(a, b) ?? 0 } : {}),
    });
    return () => clearDatasetTransform(dataset, OWNER);
  }, [dataset, attached, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** What the plugin draws in the dataset slot above every grid: nothing unless attached. */
export function DatasetSlot({ dataset }: { dataset: string }) {
  const attached = useAttached().includes(dataset);
  useApplier(dataset, attached);
  const tb = useToolbar();
  if (!attached || !tb.show) return null;
  return <FilterToolbar dataset={dataset} config={tb} />;
}

/* ---------------- the toolbar ---------------- */

function useCounts(dataset: string): { shown: number; total: number } | null {
  useDatasetsRevision();
  const ds = getDatasetOrLast(dataset);
  const s = useFilterState(dataset);
  if (!ds) return null;
  if (!stateFilters(s)) return { shown: ds.rows.length, total: ds.rows.length };
  const f = makeFilter(s, ds.fields, (r) => datasetRowText(ds, r));
  return { shown: ds.rows.filter(f).length, total: ds.rows.length };
}

function ToolButton({ a, onClick, disabled, on, children }: { a: ToolbarAction; onClick?: () => void; disabled?: boolean; on?: boolean; children?: ReactNode }) {
  const text = a.display !== 'icon' ? (children ?? a.label) : undefined;
  return (
    <Button tone={on ? 'primary' : a.tone} size={a.size} icon={a.display !== 'label' ? a.icon : undefined} onClick={onClick} disabled={disabled}
      aria-label={a.label} title={a.label} aria-pressed={on} className={`axp-basic-filter__btn ${on ? 'is-on' : ''}`}>
      {text}
    </Button>
  );
}

/**
 * The toolbar. With `preview` it's drawn from the given config without touching any dataset (the settings preview);
 * otherwise its buttons work on `dataset`.
 */
export function FilterToolbar({ dataset, config, preview }: { dataset: string; config: ToolbarConfig; preview?: boolean }) {
  const rt = useRuntime();
  const s = useFilterState(dataset);
  const counts = useCounts(dataset);
  const set = (next: FilterState) => { if (!preview) saveState(rt, dataset, next); };
  const fieldOf = (a: ToolbarAction) => a.field ?? getDataset(dataset)?.fields[0]?.id ?? '';
  const visible = config.actions.filter((a) => a.visible);
  return (
    <div className={`fx-toolbar axp-basic-filter__bar ${preview ? 'is-preview' : ''}`} role="toolbar" aria-label={`Filter toolbar${preview ? ' (preview)' : ''}`} data-align={config.align}>
      {visible.map((a) => {
        const p = presetOf(a.preset);
        if (!p) return null;
        if (p.kind === 'separator') return <span key={a.uid} className="axp-basic-filter__sep" aria-hidden="true" />;
        if (p.kind === 'spacer') return <span key={a.uid} className="axp-basic-filter__spacer" aria-hidden="true" />;
        if (p.kind === 'count') {
          const c = preview ? { shown: 12, total: 40 } : counts;
          return <span key={a.uid} className="fx-chip axp-basic-filter__count" title={a.label}>{a.display !== 'label' && <Icon name={a.icon} size={12} />}{c ? `${c.shown} of ${c.total}` : '—'}{a.display !== 'icon' ? ` ${a.label.toLowerCase()}` : ''}</span>;
        }
        if (p.kind === 'search') {
          return (
            <label key={a.uid} className="axp-basic-filter__search">
              {a.display !== 'label' && <Icon name={a.icon} size={14} />}
              <input className="fx-input axp-basic-filter__search-input" type="search" value={preview ? '' : s.query} placeholder={a.display !== 'icon' ? a.label : ''}
                aria-label={a.label} onChange={(e) => set({ ...s, query: e.target.value })} readOnly={preview} />
            </label>
          );
        }
        switch (p.id) {
          case 'open-dialog': {
            const n = preview ? 0 : (s.query.trim() ? 1 : 0) + s.rules.filter(ruleReady).length + s.sort.length;
            return <ToolButton key={a.uid} a={a} on={n > 0} onClick={() => !preview && rt.openDialog(DIALOG, { dataset })}>{n ? `${a.label} (${n})` : undefined}</ToolButton>;
          }
          case 'clear': return <ToolButton key={a.uid} a={a} disabled={!preview && !stateActive(s)} onClick={() => set(EMPTY_STATE)} />;
          case 'sort-asc': case 'sort-desc': {
            const dir = p.id === 'sort-asc' ? 1 : -1;
            const f = fieldOf(a);
            const on = s.sort.length === 1 && s.sort[0]!.field === f && s.sort[0]!.dir === dir;
            return <ToolButton key={a.uid} a={a} on={!preview && on} disabled={!preview && !f} onClick={() => f && set(toggleSort(s, f, dir))} />;
          }
          case 'match': return <ToolButton key={a.uid} a={a} onClick={() => set({ ...s, match: s.match === 'all' ? 'any' : 'all' })}>{`${a.label}: ${s.match}`}</ToolButton>;
          default: return null;
        }
      })}
      {!visible.length && <span className="axp-basic-filter__muted">No buttons — add some in Settings → Plugins → Basic filter.</span>}
    </div>
  );
}

/* ---------------- the sort & filter dialog ---------------- */

const opOptions = OPS.map((o) => ({ value: o.id, label: o.label }));

function RuleRow({ rule, ds, onChange, onRemove }: { rule: Rule; ds: DatasetInfo<unknown>; onChange: (r: Rule) => void; onRemove: () => void }) {
  const op = OPS.find((o) => o.id === rule.op)!;
  const field = ds.fields.find((f) => f.id === rule.field);
  const choices = useMemo(() => (op.needs === 'list' && field ? distinct(ds.rows, field) : []), [op.needs, field, ds.rows]);
  return (
    <div className={`axp-basic-filter__rule ${rule.off ? 'is-off' : ''}`}>
      <div className="axp-basic-filter__rule-line">
        <SelectField label="Column" value={rule.field} options={ds.fields.map((f) => ({ value: f.id, label: f.label }))} onChange={(v) => onChange({ ...rule, field: v })} />
        <SelectField label="Condition" value={rule.op} options={opOptions} onChange={(v) => onChange({ ...rule, op: v as Rule['op'] })} />
        {op.needs !== 0 && op.needs !== 'list' && <TextField label={op.needs === 2 ? 'From' : 'Value'} value={rule.value} onChange={(v) => onChange({ ...rule, value: v })} type={op.numeric ? 'text' : 'search'} placeholder={op.numeric ? 'number or date' : ''} />}
        {op.needs === 2 && <TextField label="To" value={rule.value2 ?? ''} onChange={(v) => onChange({ ...rule, value2: v })} placeholder="number or date" />}
        <div className="axp-basic-filter__rule-tools">
          <Switch hideLabel label={rule.off ? 'Rule off' : 'Rule on'} checked={!rule.off} onChange={(on) => onChange({ ...rule, off: !on })} />
          <IconButton icon="trash" label="Remove rule" onClick={onRemove} />
        </div>
      </div>
      {op.needs === 'list' && (choices.length
        ? <ChoiceGrid multiple label="Values" choices={choices.map((c) => ({ id: c, title: c }))} selected={rule.values ?? []}
            onToggle={(id) => { const cur = rule.values ?? []; onChange({ ...rule, values: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }); }} />
        : <p className="axp-basic-filter__muted">This column has no values to pick from.</p>)}
    </div>
  );
}

function DatasetPicker({ onPick }: { onPick: (id: string) => void }) {
  useDatasetsRevision();
  const attached = useAttached();
  const list = knownDatasets().filter((d) => d.mounted);
  return (
    <div className="axp-basic-filter__stack">
      <p className="axp-basic-filter__muted">Pick the dataset (a grid on screen) to sort and filter.</p>
      {list.length ? list.map((d) => (
        <Button key={d.id} icon="grid" onClick={() => onPick(d.id)}>{d.label}{attached.includes(d.id) ? '' : ' (not attached)'}</Button>
      )) : <Note tone="info">No grid is on screen right now. Open a page with a grid first.</Note>}
    </div>
  );
}

export function FilterDialog({ dataset: initial, close }: { dataset?: string; close: () => void }) {
  const rt = useRuntime();
  useDatasetsRevision();
  const [dataset, setDataset] = useState(initial ?? '');
  const s = useFilterState(dataset);
  const attached = useAttached().includes(dataset);
  const counts = useCounts(dataset);
  const ds = dataset ? getDatasetOrLast(dataset) : undefined;
  if (!dataset) return <DatasetPicker onPick={setDataset} />;
  if (!ds) return <Note tone="warning">The dataset “{dataset}” hasn't been on screen yet. Open the page that shows it, then try again.</Note>;
  const set = (next: FilterState) => saveState(rt, dataset, next);
  const firstField = ds.fields[0]?.id ?? '';
  const sortOpts = ds.fields.map((f) => ({ value: f.id, label: f.label }));
  return (
    <div className="axp-basic-filter__dialog">
      <div className="axp-basic-filter__dialog-head">
        <strong>{ds.label}</strong>
        {!ds.mounted && <span className="axp-basic-filter__muted">not on screen — applies when its page opens</span>}
        <span className="fx-chip">{counts ? `${counts.shown} of ${counts.total} rows` : ''}</span>
      </div>
      {!attached && (
        <Note tone="warning">
          Basic filter isn't attached to this dataset, so changes here won't show.{' '}
          <Button size="sm" tone="primary" icon="check" onClick={() => setAttached(rt, dataset, true)}>Attach it</Button>
        </Note>
      )}
      <TextField label="Search" type="search" value={s.query} onChange={(v) => set({ ...s, query: v })} placeholder="Every word must appear in the row" autoFocus />

      <section className="axp-basic-filter__section" aria-label="Filter rules">
        <div className="axp-basic-filter__section-head">
          <strong>Filter</strong>
          <Segmented label="Rows must match" size="sm" value={s.match} onChange={(v) => set({ ...s, match: v })} options={[{ value: 'all', label: 'All rules' }, { value: 'any', label: 'Any rule' }]} />
        </div>
        {s.rules.map((r, i) => (
          <RuleRow key={r.id} rule={r} ds={ds} onChange={(nr) => set({ ...s, rules: s.rules.map((x, j) => (j === i ? nr : x)) })} onRemove={() => set({ ...s, rules: s.rules.filter((_, j) => j !== i) })} />
        ))}
        <div><Button size="sm" icon="plus" disabled={!firstField} onClick={() => set({ ...s, rules: [...s.rules, { id: newUid(), field: firstField, op: 'contains', value: '' }] })}>Add rule</Button></div>
      </section>

      <section className="axp-basic-filter__section" aria-label="Sort">
        <div className="axp-basic-filter__section-head"><strong>Sort</strong><span className="axp-basic-filter__muted">{s.sort.length ? 'First key wins, the next breaks ties' : 'As the dataset gives it'}</span></div>
        {s.sort.map((k, i) => (
          <div key={`${k.field}-${i}`} className="axp-basic-filter__sortkey">
            <SelectField label={i ? 'Then by' : 'Sort by'} value={k.field} options={sortOpts} onChange={(v) => set({ ...s, sort: s.sort.map((x, j) => (j === i ? { ...x, field: v } : x)) })} />
            <Segmented label="Direction" size="sm" value={k.dir === 1 ? 'asc' : 'desc'} onChange={(v) => set({ ...s, sort: s.sort.map((x, j) => (j === i ? { ...x, dir: v === 'asc' ? 1 : -1 } : x)) })}
              options={[{ value: 'asc', label: 'A → Z', icon: 'chevron-up' }, { value: 'desc', label: 'Z → A', icon: 'chevron-down' }]} />
            <IconButton icon="chevron-up" label="Move up" disabled={!i} onClick={() => { const n = [...s.sort]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; set({ ...s, sort: n }); }} />
            <IconButton icon="trash" label="Remove sort key" onClick={() => set({ ...s, sort: s.sort.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <div><Button size="sm" icon="plus" disabled={!firstField} onClick={() => set({ ...s, sort: [...s.sort, { field: firstField, dir: 1 }] })}>Add sort level</Button></div>
      </section>

      <div className="axp-basic-filter__foot">
        <Button tone="quiet" icon="x" disabled={!stateActive(s)} onClick={() => set(EMPTY_STATE)}>Reset</Button>
        <Button tone="primary" icon="check" onClick={close}>Done</Button>
      </div>
    </div>
  );
}

/* ---------------- attach to datasets ---------------- */

/** Every dataset seen (and every attached one) with a switch. Used in this plugin's settings and in Plugin switches. */
export function AttachList({ compact }: { compact?: boolean }) {
  const rt = useRuntime();
  useDatasetsRevision();
  const attached = useAttached();
  const [byId, setById] = useState('');
  const seen = knownDatasets();
  const rows = [...seen, ...attached.filter((a) => !seen.some((d) => d.id === a)).map((id) => ({ id, label: id, fields: [], mounted: false }))]
    .sort((a, b) => Number(b.mounted) - Number(a.mounted) || a.label.localeCompare(b.label));
  return (
    <div className={`axp-basic-filter__attach ${compact ? 'is-compact' : ''}`}>
      {rows.length ? (
        <ul className="axp-basic-filter__attach-list">
          {rows.map((d) => {
            const on = attached.includes(d.id);
            const filtered = on && stateActive(readState(rt, d.id));
            return (
              <li key={d.id} className={`axp-basic-filter__attach-row ${on ? 'is-active' : ''}`}>
                <span className="axp-basic-filter__attach-text">
                  <span className="axp-basic-filter__attach-name">{d.label}</span>
                  <span className="axp-basic-filter__muted">{d.id}{d.mounted ? ' · on screen' : ''}{filtered ? ' · filtered' : ''}</span>
                </span>
                <Switch hideLabel label={`Attach Basic filter to ${d.label}`} title={on ? 'Detach' : 'Attach'} checked={on} onChange={(v) => setAttached(rt, d.id, v)} />
              </li>
            );
          })}
        </ul>
      ) : <p className="axp-basic-filter__muted">No dataset seen yet. Every grid becomes a dataset once its page is open.</p>}
      {!compact && (
        <div className="axp-basic-filter__byid">
          <TextField label="Attach by dataset id" value={byId} onChange={setById} placeholder="e.g. a grid id" mono />
          <Button icon="plus" disabled={!byId.trim()} onClick={() => { setAttached(rt, byId.trim(), true); setById(''); }}>Attach</Button>
        </div>
      )}
    </div>
  );
}

/** The row extra in Plugin switches: how many datasets it's attached to, opening the attach list. */
export function SwitchesExtra({ enabled }: { enabled: boolean }) {
  const attached = useAttached();
  const [open, setOpen] = useState(false);
  return (
    <div className="axp-basic-filter__switches">
      <Button size="sm" tone="quiet" className="axp-basic-filter__toggle" icon={open ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Datasets: {attached.length ? `${attached.length} attached` : 'none attached'}
      </Button>
      {open && (enabled ? <AttachList compact /> : <p className="axp-basic-filter__muted">Turn Basic filter on to attach it.</p>)}
    </div>
  );
}

/* ---------------- toolbar designer + live floating preview ---------------- */

const toneOpts: { value: Tone; label: string }[] = (['neutral', 'primary', 'ghost', 'quiet', 'success', 'danger'] as Tone[]).map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }));
const displayOpts: { value: Display; label: string }[] = [{ value: 'icon', label: 'Icon' }, { value: 'label', label: 'Label' }, { value: 'both', label: 'Both' }];
const ICONS = ['sliders', 'search', 'x', 'chevron-up', 'chevron-down', 'list', 'grid', 'shuffle', 'chart', 'star', 'eye', 'refresh', 'check', 'zap', 'layers', 'minus', 'arrow-right'];

type Line = { kind: 'action'; a: ToolbarAction; i: number } | { kind: 'preset'; p: Preset };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="axp-basic-filter__kv"><span className="axp-basic-filter__muted">{label}</span><span>{children}</span></div>;
}

function ActionEditor({ a, i, count, update, move, remove }: { a: ToolbarAction; i: number; count: number; update: (p: Partial<ToolbarAction>) => void; move: (d: -1 | 1) => void; remove: () => void }) {
  const p = presetOf(a.preset)!;
  useDatasetsRevision();
  const fields = [...new Map(knownDatasets().flatMap((d) => d.fields).map((f) => [f.id, f])).values()];
  return (
    <div className="axp-basic-filter__detail">
      <p className="axp-basic-filter__does">{p.does}</p>
      <div className="axp-basic-filter__edit">
        <TextField label="Label (also the tooltip)" value={a.label} onChange={(v) => update({ label: v })} />
        <SelectField label="Icon" value={a.icon} options={ICONS.map((x) => ({ value: x, label: x }))} onChange={(v) => update({ icon: v })} />
        <SelectField label="Tone" value={a.tone} options={toneOpts} onChange={(v) => update({ tone: v as Tone })} />
        <Segmented label="Shows" size="sm" value={a.display} options={displayOpts} onChange={(v) => update({ display: v })} />
        <Segmented label="Size" size="sm" value={a.size} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }]} onChange={(v) => update({ size: v })} />
        {p.needsField && (
          <TextField label="Sort by column id (empty = the dataset's first column)" value={a.field ?? ''} onChange={(v) => update({ field: v || undefined })} mono
            hint={fields.length ? `Seen: ${fields.slice(0, 12).map((f) => f.id).join(', ')}` : undefined} />
        )}
      </div>
      <div className="axp-basic-filter__kvs">
        <Detail label="Action">{p.name} ({p.id})</Detail>
        <Detail label="Kind">{p.kind}</Detail>
        <Detail label="Position">{i + 1} of {count}</Detail>
        <Detail label="Default style">{p.style.display} · {p.style.tone} · {p.style.size} · {p.style.icon}</Detail>
      </div>
      <div className="axp-basic-filter__row">
        <Switch label="Shown on the toolbar" checked={a.visible} onChange={(v) => update({ visible: v })} />
        <Button size="sm" icon="chevron-up" disabled={!i} onClick={() => move(-1)}>Move left</Button>
        <Button size="sm" icon="chevron-down" disabled={i === count - 1} onClick={() => move(1)}>Move right</Button>
        <Button size="sm" icon="undo" onClick={() => update({ ...p.style })}>Reset style</Button>
        <Button size="sm" tone="danger" icon="trash" onClick={remove}>Remove</Button>
      </div>
    </div>
  );
}

function PresetDetail({ p, onAdd }: { p: Preset; onAdd: () => void }) {
  return (
    <div className="axp-basic-filter__detail">
      <p className="axp-basic-filter__does">{p.does}</p>
      <div className="axp-basic-filter__kvs">
        <Detail label="Action id">{p.id}</Detail>
        <Detail label="Kind">{p.kind}</Detail>
        <Detail label="Label">{p.style.label}</Detail>
        <Detail label="Icon"><Icon name={p.style.icon} size={14} /> {p.style.icon}</Detail>
        <Detail label="Shows">{p.style.display}</Detail>
        <Detail label="Tone">{p.style.tone}</Detail>
        <Detail label="Size">{p.style.size}</Detail>
        {p.needsField && <Detail label="Needs">a column to sort by</Detail>}
      </div>
      <div><Button size="sm" tone="primary" icon="plus" onClick={onAdd}>Add to the toolbar</Button></div>
    </div>
  );
}

/** Floating live preview of the toolbar (portal on the page): drag it by its bar; re-renders on every edit. */
function FloatingPreview({ config, onClose }: { config: ToolbarConfig; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  // start in the bottom-right corner, fully on screen (measured, so any theme's sizes fit)
  useLayoutEffect(() => {
    if (pos || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ x: Math.max(8, window.innerWidth - r.width - 16), y: Math.max(8, window.innerHeight - r.height - 16) });
  }, [pos]);
  const clamp = (x: number, y: number) => {
    const r = box.current?.getBoundingClientRect();
    return { x: Math.min(window.innerWidth - (r?.width ?? 80), Math.max(0, x)), y: Math.min(window.innerHeight - (r?.height ?? 40), Math.max(0, y)) };
  };
  return createPortal(
    <div ref={box} className="axp-basic-filter__float fx-popover" style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden', left: 0, top: 0 }} role="dialog" aria-label="Toolbar live preview">
      <div className="axp-basic-filter__float-bar"
        onPointerDown={(e) => { if (!pos) return; drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy)); }}
        onPointerUp={() => { drag.current = null; }}>
        <strong>Live preview</strong>
        <span className="axp-basic-filter__muted">{config.show ? 'drag to move' : 'Toolbar hidden'}</span>
        <IconButton icon="x" label="Close the preview" onClick={onClose} />
      </div>
      <div className={config.show ? '' : 'axp-basic-filter__dim'}><FilterToolbar dataset="__basic-filter-preview" config={config} preview /></div>
    </div>,
    document.body,
  );
}

export function ToolbarDesigner() {
  const rt = useRuntime();
  const tb = useToolbar();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [preview, setPreview] = useState(true);
  const save = (t: ToolbarConfig) => saveToolbar(rt, t);
  const update = (uid: string, p: Partial<ToolbarAction>) => save({ ...tb, actions: tb.actions.map((a) => (a.uid === uid ? { ...a, ...p } : a)) });
  const move = (i: number, d: -1 | 1) => { const n = [...tb.actions]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j]!, n[i]!]; save({ ...tb, actions: n }); };
  const add = (p: Preset) => { const a = actionFrom(p); save({ ...tb, actions: [...tb.actions, a] }); setExpanded((x) => [...x, `act:${a.uid}`]); };

  const lineId = (l: Line) => (l.kind === 'action' ? `act:${l.a.uid}` : `pre:${l.p.id}`);
  const columns: GridColumn<Line>[] = [
    { id: 'name', label: 'Action', width: 'minmax(calc(var(--fx-space) * 16), 2fr)', fixed: true, render: (l) => {
      const p = l.kind === 'action' ? presetOf(l.a.preset)! : l.p;
      return <span className="axp-basic-filter__name"><Icon name={l.kind === 'action' ? l.a.icon : p.style.icon} size={14} /> {l.kind === 'action' ? l.a.label : p.name}</span>;
    } },
    { id: 'kind', label: 'Kind', width: 'minmax(calc(var(--fx-space) * 8), 1fr)', render: (l) => (l.kind === 'action' ? presetOf(l.a.preset)!.name : l.p.kind) },
    { id: 'style', label: 'Style', width: 'minmax(calc(var(--fx-space) * 14), 1.4fr)', render: (l) => { const st = l.kind === 'action' ? l.a : l.p.style; return `${st.display} · ${st.tone} · ${st.size}`; } },
    { id: 'state', label: 'State', width: 'minmax(calc(var(--fx-space) * 10), 1fr)', render: (l) => (l.kind === 'action'
      ? <Switch hideLabel label={`${l.a.label} shown`} title={l.a.visible ? 'Shown — tap to hide' : 'Hidden — tap to show'} checked={l.a.visible} onChange={(v) => update(l.a.uid, { visible: v })} />
      : <Button size="sm" icon="plus" onClick={(e) => { e.stopPropagation(); add(l.p); }}>Add</Button>) },
  ];
  const groups: GridGroup<Line>[] = [
    { id: 'toolbar', title: 'On the toolbar', icon: 'menu', collapsed: collapsed.includes('toolbar'), rows: tb.actions.map((a, i) => ({ kind: 'action', a, i })), groups: [], summary: `${tb.actions.filter((a) => a.visible).length} shown · ${tb.actions.filter((a) => !a.visible).length} hidden`, fixed: true },
    { id: 'presets', title: 'Preset actions', icon: 'zap', collapsed: collapsed.includes('presets'), rows: PRESETS.map((p) => ({ kind: 'preset', p })), groups: [], summary: `${PRESETS.length} to pick from`, fixed: true },
  ];

  return (
    <div className="axp-basic-filter__stack">
      <div className="axp-basic-filter__row">
        <Switch label="Show the toolbar on attached datasets" checked={tb.show} onChange={(v) => save({ ...tb, show: v })} />
        <Segmented label="Align" size="sm" value={tb.align} onChange={(v) => save({ ...tb, align: v })} options={[{ value: 'start', label: 'Start' }, { value: 'center', label: 'Center' }, { value: 'end', label: 'End' }]} />
        <Button size="sm" icon="eye" onClick={() => setPreview((x) => !x)}>{preview ? 'Hide preview' : 'Show live preview'}</Button>
        <Button size="sm" tone="quiet" icon="undo" onClick={() => save(structuredClone(DEFAULT_TOOLBAR))}>Back to default</Button>
      </div>
      <p className="axp-basic-filter__muted">Tap a row (or its chevron) to see everything about the action and its style. Edits save at once and the preview redraws as you go.</p>
      <DataGrid<Line>
        id="basic-filter.actions" label="Toolbar actions" dataset={false}
        groups={groups} columns={columns} rowId={lineId} rowLabel={(l) => (l.kind === 'action' ? l.a.label : l.p.name)}
        hidden={[]} expanded={expanded}
        onToggleExpand={(id) => setExpanded((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))}
        onRowClick={(l) => { const id = lineId(l); setExpanded((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])); }}
        onToggleGroup={(id) => setCollapsed((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))}
        rowTone={(l) => (l.kind === 'action' ? (l.a.visible ? 'success' : 'muted') : 'info')}
        renderDetail={(l) => (l.kind === 'action'
          ? <ActionEditor a={l.a} i={l.i} count={tb.actions.length} update={(p) => update(l.a.uid, p)} move={(d) => move(l.i, d)} remove={() => save({ ...tb, actions: tb.actions.filter((x) => x.uid !== l.a.uid) })} />
          : <PresetDetail p={l.p} onAdd={() => add(l.p)} />)}
        empty="No actions."
      />
      {preview && <FloatingPreview config={tb} onClose={() => setPreview(false)} />}
    </div>
  );
}
