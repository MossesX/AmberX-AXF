/**
 * The bugs board (lazy-loaded): confirmed bugs grouped by the build they are part of, each build with its live state
 * (running with agent and step, queued with its place in line, built with PR, merged), Unassigned below. Drag a bug by
 * its grip (finger or mouse) to reorder it or drop it on another build; multi-select drags them all. Right-click (or
 * long-press) a bug for Move to build…, New build from bug(s), Open build, Mark fixed, Edit.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AgentAvatar, Button, Checkbox, Chip, Container, Icon, IconButton, Note, openRef, Segmented, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { act, preview, setFilter, useBoard, type Board, type Bug, type BuildInfo, type Move, type Severity } from './data';

const SEV_TONE: Record<Severity, 'danger' | 'warning' | 'accent' | undefined> = { urgent: 'danger', high: 'warning', normal: 'accent', low: undefined };
const chipTone = (t: string) => (t === 'muted' || t === 'info' ? undefined : (t as 'accent' | 'success' | 'warning' | 'danger'));

/** Which bug the editor should open (set by the context menu's Edit / Move to build…). */
let openRequest: { id: string; focus: 'edit' | 'move' } | null = null;
const openListeners = new Set<() => void>();
export function requestOpen(id: string, focus: 'edit' | 'move') { openRequest = { id, focus }; for (const l of openListeners) l(); }

/* ---------------- drag (pointer events: works for touch, pen and mouse) ---------------- */

interface Drop { build: string; before: string; fixed?: boolean }
function dropAt(x: number, y: number): Drop | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-bb-drop]');
  if (!el) return null;
  return { build: el.getAttribute('data-bb-build') ?? '', before: el.getAttribute('data-bb-before') ?? '', fixed: el.getAttribute('data-bb-drop') === 'fixed' };
}

function useDrag(onDrop: (ids: string[], d: Drop) => void) {
  const [drag, setDrag] = useState<{ ids: string[]; x: number; y: number; over: Drop | null; label: string } | null>(null);
  const start = useRef<{ x: number; y: number; ids: string[]; label: string; on: boolean } | null>(null);
  const down = (e: ReactPointerEvent<HTMLElement>, ids: string[], label: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, ids, label, on: false };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current; if (!s) return;
    if (!s.on && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
    s.on = true;
    setDrag({ ids: s.ids, x: e.clientX, y: e.clientY, over: dropAt(e.clientX, e.clientY), label: s.label });
  };
  const up = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current; start.current = null;
    if (s?.on) { const d = dropAt(e.clientX, e.clientY); if (d) onDrop(s.ids, d); }
    setDrag(null);
  };
  const cancel = () => { start.current = null; setDrag(null); };
  return { drag, handlers: (ids: string[], label: string) => ({ onPointerDown: (e: ReactPointerEvent<HTMLElement>) => down(e, ids, label), onPointerMove: move, onPointerUp: up, onPointerCancel: cancel }) };
}

/* ---------------- pieces ---------------- */

function BuildChipView({ b }: { b?: BuildInfo }) {
  if (!b) return <Chip>Unassigned</Chip>;
  return (
    <span className="axp-bb-chip">
      {b.agent && b.live === 'running' && <AgentAvatar agent={b.agent} size="small" />}
      <Chip tone={chipTone(b.chip.tone)}>{b.chip.text}</Chip>
    </span>
  );
}

function MovePicker({ bug, board, onDone }: { bug: Bug; board: Board; onDone: () => void }) {
  const [to, setTo] = useState(bug.build);
  const [err, setErr] = useState('');
  const targets = board.builds.filter((b) => b.target);
  const options = [{ value: '', label: 'Unassigned' }, ...targets.map((b) => ({ value: b.id, label: `${b.title} · ${b.chip.text}` }))];
  const go = () => act({ action: 'move', id: bug.id, build: to || '-' }).then(onDone, (e: Error) => setErr(e.message));
  return (
    <div className="axp-bb-edit__row">
      <SelectField label="Move to build" value={to} options={options} onChange={setTo} />
      <Button tone="primary" icon="arrow-right" disabled={to === bug.build} onClick={() => void go()}>Move</Button>
      {err && <Note tone="danger">{err}</Note>}
    </div>
  );
}

function Editor({ bug, board, focus, onClose }: { bug: Bug; board: Board; focus: 'edit' | 'move'; onClose: () => void }) {
  const [d, setD] = useState({ title: bug.title, details: bug.details, severity: bug.severity, app: bug.app, area: bug.area, said: bug.said, tags: bug.tags.join(', ') });
  const [err, setErr] = useState('');
  const dirty = d.title !== bug.title || d.details !== bug.details || d.severity !== bug.severity || d.app !== bug.app || d.area !== bug.area || d.said !== bug.said || d.tags !== bug.tags.join(', ');
  const save = () => act({ action: 'update', id: bug.id, patch: { ...d, tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean) } }).then(() => setErr(''), (e: Error) => setErr(e.message));
  const run = (c: Record<string, unknown>) => act(c).then(() => setErr(''), (e: Error) => setErr(e.message));
  return (
    <div className="axp-bb-edit fx-stack">
      {focus === 'move' && <MovePicker bug={bug} board={board} onDone={onClose} />}
      <TextField label="Title" value={d.title} onChange={(v) => setD({ ...d, title: v })} />
      <TextField label="Details" value={d.details} rows={3} onChange={(v) => setD({ ...d, details: v })} />
      <div className="axp-bb-edit__row">
        <SelectField label="Severity" value={d.severity} options={(['urgent', 'high', 'normal', 'low'] as const).map((s) => ({ value: s, label: s }))} onChange={(v) => setD({ ...d, severity: v as Severity })} />
        <TextField label="App" value={d.app} onChange={(v) => setD({ ...d, app: v })} />
        <TextField label="Area" value={d.area} onChange={(v) => setD({ ...d, area: v })} />
      </div>
      <TextField label="Tags (comma separated)" value={d.tags} onChange={(v) => setD({ ...d, tags: v })} />
      <TextField label="What Brett said (verbatim)" value={d.said} rows={2} onChange={(v) => setD({ ...d, said: v })} />
      {focus !== 'move' && <MovePicker bug={bug} board={board} onDone={() => undefined} />}
      <div className="axp-bb-edit__acts" role="toolbar" aria-label="Bug actions">
        {dirty && <Button tone="primary" icon="save" onClick={() => void save()}>Save</Button>}
        <Button icon="check" onClick={() => void run({ action: 'fix', id: bug.id })}>Mark fixed</Button>
        <Button icon="x" onClick={() => void run({ action: 'update', id: bug.id, patch: { status: 'wontfix' } })}>Won't fix</Button>
        {(bug.status === 'fixed' || bug.status === 'wontfix') && <Button icon="refresh" onClick={() => void run({ action: 'update', id: bug.id, patch: { status: 'confirmed' } })}>Reopen</Button>}
        <Button icon="plus" onClick={() => void run({ action: 'new-build', ids: [bug.id] })}>New build from bug</Button>
        <Button tone="danger" icon="trash" confirm="Remove this bug from the board?" onClick={() => void run({ action: 'remove', id: bug.id }).then(onClose)}>Remove</Button>
        <Button tone="ghost" onClick={onClose}>Close</Button>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {bug.history.length > 0 && (
        <details className="axp-bb-hist"><summary>History ({bug.history.length})</summary>
          <ul>{[...bug.history].reverse().map((h, i) => <li key={i}><span className="axp-bb-muted">{h.at.slice(0, 16).replace('T', ' ')} · {h.by}</span> {h.what}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Row({ bug, board, build, selected, onSelect, open, onOpen, dragProps, over, showBuild }: {
  bug: Bug; board: Board; build?: BuildInfo; selected: boolean; onSelect: (on: boolean) => void; open: 'edit' | 'move' | null; onOpen: (f: 'edit' | 'move' | null) => void;
  dragProps: ReturnType<ReturnType<typeof useDrag>['handlers']>; over: boolean; showBuild: boolean;
}) {
  const [err, setErr] = useState('');
  const pick = (to: string) => act({ action: 'move', id: bug.id, build: to }).then(() => setErr(''), (e: Error) => setErr(e.message));
  return (
    <li className={`axp-bb-row${over ? ' is-over' : ''}${selected ? ' is-selected' : ''}`} data-bb-drop="row" data-bb-build={bug.status === 'fixed' || bug.status === 'wontfix' ? '' : bug.build} data-bb-before={bug.id}
      data-fx-ctx-target="axf-bug" data-fx-ctx-payload={bug.id}>
      <div className="axp-bb-row__main">
        <span className="axp-bb-grip" aria-label={`Drag ${bug.title}`} title="Drag to reorder or onto a build" {...dragProps}><Icon name="grip" size={16} /></span>
        <Checkbox label="" title={`Select ${bug.title}`} checked={selected} onChange={onSelect} />
        <Chip tone={SEV_TONE[bug.severity]}>{bug.severity}</Chip>
        <button type="button" className="axp-bb-row__title" data-fx-row onClick={() => onOpen(open ? null : 'edit')} aria-expanded={!!open}>
          <strong>{bug.title}</strong>
          <span className="axp-bb-muted">{[bug.app, bug.area].filter(Boolean).join(' · ')}{bug.status === 'fixed' && bug.fixedPr ? ` · fixed in ${bug.fixedPr}` : ''}</span>
        </button>
        {showBuild && <BuildChipView b={build} />}
      </div>
      {bug.needsBrett && (
        <Note tone="warning" icon="alert">
          Nobody took it. Pick a build: {bug.candidates.length ? bug.candidates.map((c) => <Button key={c} size="sm" onClick={() => void pick(c)}>{board.builds.find((b) => b.id === c)?.title ?? c}</Button>) : 'no build fits; drag it onto one or start a new build.'}
        </Note>
      )}
      {err && <Note tone="danger">{err}</Note>}
      {open && <Editor bug={bug} board={board} focus={open} onClose={() => onOpen(null)} />}
    </li>
  );
}

function GroupHead({ label, build, count, onOpenBuild }: { label: string; build?: BuildInfo; count: number; onOpenBuild?: () => void }) {
  return (
    <div className="axp-bb-group__head">
      <strong className="axp-bb-group__title">{label}</strong>
      <span className="axp-bb-muted">{count}</span>
      {build && <BuildChipView b={build} />}
      {build && !build.target && <span className="axp-bb-muted">closed to new bugs</span>}
      {onOpenBuild && <IconButton icon="external" label="Open build" onClick={onOpenBuild} />}
    </div>
  );
}

function AddBug({ onDone }: { onDone: () => void }) {
  const [d, setD] = useState({ title: '', details: '', severity: 'normal' as Severity, app: 'console-web', area: '', said: '' });
  const [err, setErr] = useState('');
  const add = () => act({ action: 'add', bug: d }).then(() => { setD({ ...d, title: '', details: '', said: '' }); onDone(); }, (e: Error) => setErr(e.message));
  return (
    <Container title="New confirmed bug" icon="plus">
      <div className="fx-stack">
        <TextField label="Title" value={d.title} autoFocus onChange={(v) => setD({ ...d, title: v })} />
        <TextField label="Details" value={d.details} rows={2} onChange={(v) => setD({ ...d, details: v })} />
        <div className="axp-bb-edit__row">
          <SelectField label="Severity" value={d.severity} options={(['urgent', 'high', 'normal', 'low'] as const).map((s) => ({ value: s, label: s }))} onChange={(v) => setD({ ...d, severity: v as Severity })} />
          <TextField label="App" value={d.app} onChange={(v) => setD({ ...d, app: v })} />
          <TextField label="Area" value={d.area} onChange={(v) => setD({ ...d, area: v })} />
        </div>
        <TextField label="What Brett said (verbatim)" value={d.said} rows={2} onChange={(v) => setD({ ...d, said: v })} />
        <div className="axp-bb-edit__acts" role="toolbar" aria-label="New bug actions">
          <Button tone="primary" icon="plus" disabled={!d.title.trim()} onClick={() => void add()}>Add bug</Button>
          <Button tone="ghost" onClick={onDone}>Cancel</Button>
        </div>
        {err && <Note tone="danger">{err}</Note>}
      </div>
    </Container>
  );
}

function OptimizePreview({ moves, unclear, board, onClose }: { moves: Move[]; unclear: string[]; board: Board; onClose: () => void }) {
  const [err, setErr] = useState('');
  const title = (id: string) => board.bugs.find((b) => b.id === id)?.title ?? id;
  const btitle = (id: string) => board.builds.find((b) => b.id === id)?.title ?? id;
  const apply = () => act({ action: 'optimize' }).then(onClose, (e: Error) => setErr(e.message));
  return (
    <Container title="Auto-optimize: proposed moves" icon="sparkles">
      <div className="fx-stack">
        {!moves.length && <p className="axp-bb-muted">Nothing to move: every open bug is in a build, or no queued or running build fits.</p>}
        <ul className="axp-bb-moves">{moves.map((m) => <li key={m.bug}><strong>{title(m.bug)}</strong> <Icon name="arrow-right" size={14} /> {btitle(m.to)} <span className="axp-bb-muted">({m.why.join('; ')})</span></li>)}</ul>
        {unclear.length > 0 && <p className="axp-bb-muted">No clear match for: {unclear.map(title).join(', ')}.</p>}
        <p className="axp-bb-muted">Each move is offered in the crew chat: the build's agent takes it or bounces it to the next best build.</p>
        <div className="axp-bb-edit__acts" role="toolbar" aria-label="Optimize actions">
          <Button tone="primary" icon="check" disabled={!moves.length} onClick={() => void apply()}>Apply</Button>
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
        </div>
        {err && <Note tone="danger">{err}</Note>}
      </div>
    </Container>
  );
}

/* ---------------- the board ---------------- */

export function BugsBoard() {
  const rt = useRuntime();
  const { board, error, filter } = useBoard();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Record<string, 'edit' | 'move'>>({});
  const [adding, setAdding] = useState(false);
  const [plan, setPlan] = useState<{ moves: Move[]; unclear: string[] } | null>(null);
  const [view, setView] = useState<'grouped' | 'list'>('grouped');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  useEffect(() => {
    const l = () => { if (openRequest) { const r = openRequest; openRequest = null; setOpen((o) => ({ ...o, [r.id]: r.focus })); } };
    openListeners.add(l); l();
    return () => { openListeners.delete(l); };
  }, []);
  const report = (p: Promise<{ log: string[]; chat?: { from: string; text: string }[] }>) => p.then((r) => setMsg({ tone: 'success', text: [r.log.join(' · '), ...(r.chat ?? []).map((c) => `${c.from}: ${c.text}`)].filter(Boolean).join('\n') }), (e: Error) => setMsg({ tone: 'danger', text: e.message }));
  const onDrop = (ids: string[], d: Drop) => {
    if (!board) return;
    const moving = ids.includes(d.before) ? ids.filter((x) => x !== d.before) : ids;
    void report((async () => {
      const log: string[] = []; const chat: { from: string; text: string }[] = [];
      for (const id of moving) {
        const bug = board.bugs.find((b) => b.id === id); if (!bug) continue;
        if (d.fixed) { const r = await act({ action: 'fix', id }); log.push(...r.log); continue; }
        if (bug.build !== d.build) { const r = await act({ action: 'move', id, build: d.build || '-' }); log.push(...r.log); chat.push(...(r.chat ?? [])); }
      }
      if (d.before || !d.fixed) { const order = board.bugs.map((b) => b.id).filter((x) => !moving.includes(x)); const at = d.before ? order.indexOf(d.before) : order.length; order.splice(at < 0 ? order.length : at, 0, ...moving); const r = await act({ action: 'reorder', ids: order }); log.push(...r.log); }
      setSelected(new Set());
      return { log: [...new Set(log)], chat };
    })());
  };
  const { drag, handlers } = useDrag(onDrop);
  const buildOf = useMemo(() => new Map((board?.builds ?? []).map((b) => [b.id, b])), [board]);
  const profiles = useMemo(() => [...new Set((board?.builds ?? []).flatMap((b) => b.profiles))].sort(), [board]);

  if (error && !board) return <Note tone="danger">Bugs board unavailable: {error}</Note>;
  if (!board) return <p className="axp-bb-muted">Loading the bugs board…</p>;
  const s = board.settings;
  const drop = drag?.over;
  const isOver = (build: string, before = '') => !!drop && !drop.fixed && drop.build === build && drop.before === before;
  const sel = (id: string, on: boolean) => setSelected((x) => { const n = new Set(x); if (on) n.add(id); else n.delete(id); return n; });
  const dragFor = (bug: Bug) => handlers(selected.has(bug.id) ? [...selected] : [bug.id], selected.has(bug.id) && selected.size > 1 ? `${selected.size} bugs` : bug.title);
  const row = (bug: Bug, showBuild: boolean) => (
    <Row key={bug.id} bug={bug} board={board} build={buildOf.get(bug.build)} selected={selected.has(bug.id)} onSelect={(on) => sel(bug.id, on)}
      open={open[bug.id] ?? null} onOpen={(f) => setOpen((o) => { const n = { ...o }; if (f) n[bug.id] = f; else delete n[bug.id]; return n; })}
      dragProps={dragFor(bug)} over={isOver(bug.build, bug.id)} showBuild={showBuild} />
  );
  const emptyTargets = drag ? board.builds.filter((b) => b.target && !board.groups.some((g) => g.build === b.id)) : [];

  return (
    <div className="fx-stack fx-stack--lg axp-bb">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Builds</p><h1>Bugs</h1>
          <p className="axp-bb-muted">{board.banner.open} open · {board.banner.unassigned} unassigned{board.banner.needsBrett ? ` · ${board.banner.needsBrett} need you` : ''}</p></div>
      </header>
      <div className="axp-bb-bar" role="toolbar" aria-label="Bugs board">
        <Button tone="primary" icon="plus" onClick={() => setAdding((a) => !a)}>Add bug</Button>
        <Switch label="Auto-optimize" checked={s.autoOptimize} title="Moves new and unassigned bugs into the best queued or running build by itself" onChange={(on) => void report(act({ action: 'settings', values: { autoOptimize: on } }).then(async (r) => (on ? act({ action: 'optimize' }) : r)))} />
        <Button icon="sparkles" onClick={() => void preview().then(setPlan, (e: Error) => setMsg({ tone: 'danger', text: e.message }))}>Optimize…</Button>
        <Button icon="undo" disabled={!board.canUndo} title={board.undo ? `Undo: ${board.undo.what}` : 'Nothing to undo'} onClick={() => void report(act({ action: 'undo' }))}>Undo</Button>
        {selected.size > 0 && <Button icon="plus" onClick={() => void report(act({ action: 'new-build', ids: [...selected] }).then((r) => { setSelected(new Set()); return r; }))}>New build from {selected.size}</Button>}
        {selected.size > 0 && <Button icon="check" onClick={() => void report(Promise.all([...selected].map((id) => act({ action: 'fix', id }))).then((rs) => { setSelected(new Set()); return { log: rs.flatMap((r) => r.log) }; }))}>Mark {selected.size} fixed</Button>}
        <Segmented label="View" size="sm" value={view} onChange={setView} options={[{ value: 'grouped', label: 'By build' }, { value: 'list', label: 'List' }]} />
        <Segmented label="Status" size="sm" value={filter.status} onChange={(v) => setFilter({ status: v })} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }, { value: 'fixed', label: 'Fixed' }, { value: 'wontfix', label: "Won't fix" }]} />
        <SelectField label="App" value={filter.app} options={[{ value: '', label: 'Every app' }, ...board.apps.map((a) => ({ value: a, label: a }))]} onChange={(v) => setFilter({ app: v })} />
        <SelectField label="Profile" value={filter.profile} options={[{ value: '', label: 'Every profile' }, ...profiles.map((p) => ({ value: p, label: p }))]} onChange={(v) => setFilter({ profile: v })} />
      </div>
      {msg && <Note tone={msg.tone}><span className="axp-bb-pre">{msg.text}</span> <IconButton icon="x" label="Dismiss" onClick={() => setMsg(null)} /></Note>}
      {adding && <AddBug onDone={() => setAdding(false)} />}
      {plan && <OptimizePreview moves={plan.moves} unclear={plan.unclear} board={board} onClose={() => setPlan(null)} />}
      {view === 'list' ? (
        <ul className="axp-bb-list" data-bb-drop="list" data-bb-build="" data-bb-before="">{board.groups.flatMap((g) => g.items).sort((a, b) => a.order - b.order).map((b) => row(b, true))}</ul>
      ) : (
        board.groups.map((g) => {
          const b = buildOf.get(g.build);
          const fixed = g.key === '~fixed';
          return (
            <section key={g.key} className={`axp-bb-group${drop && drop.build === g.build && !drop.before && !drop.fixed && !g.key.startsWith('~f') && !g.key.startsWith('~w') ? ' is-over' : ''}`}
              data-bb-drop={fixed ? 'fixed' : g.key === '~wontfix' ? undefined : 'group'} data-bb-build={g.build} data-bb-before="">
              <GroupHead label={g.label} build={b} count={g.items.length} onOpenBuild={g.build ? () => openRef(rt, g.build) : undefined} />
              <ul className="axp-bb-list">{g.items.map((bug) => row(bug, false))}</ul>
            </section>
          );
        })
      )}
      {!board.groups.length && <p className="axp-bb-muted">No bugs here. Add one, or switch the status filter.</p>}
      {emptyTargets.length > 0 && (
        <section className="axp-bb-targets" aria-label="Drop onto a build">
          <p className="fx-eyebrow">Drop onto a build</p>
          {emptyTargets.map((b) => (
            <div key={b.id} className={`axp-bb-target${drop?.build === b.id ? ' is-over' : ''}`} data-bb-drop="group" data-bb-build={b.id} data-bb-before="">
              <strong>{b.title}</strong> <BuildChipView b={b} />
            </div>
          ))}
          <div className={`axp-bb-target${drop?.fixed ? ' is-over' : ''}`} data-bb-drop="fixed" data-bb-build="" data-bb-before=""><Icon name="check" size={14} /> Mark fixed</div>
        </section>
      )}
      {drag && <div className="axp-bb-ghost" style={{ ['--bb-x' as string]: drag.x, ['--bb-y' as string]: drag.y }} aria-hidden="true"><Icon name="grip" size={14} /> {drag.label}</div>}
    </div>
  );
}

/* ---------------- settings (Settings → Plugins → Bugs) ---------------- */

export function BugsSettings() {
  const { board, error } = useBoard();
  const [err, setErr] = useState('');
  if (error && !board) return <Note tone="danger">Bugs board unavailable: {error}</Note>;
  if (!board) return <p className="axp-bb-muted">Loading…</p>;
  const s = board.settings;
  const set = (values: Record<string, unknown>) => act({ action: 'settings', values }).then(() => setErr(''), (e: Error) => setErr(e.message));
  const num = (label: string, key: keyof typeof s, hint: string) => (
    <TextField label={label} type="number" value={String(s[key])} hint={hint} onChange={(v) => { if (v !== '' && Number.isFinite(Number(v))) void set({ [key]: Number(v) }); }} />
  );
  return (
    <div className="fx-stack">
      <Switch label="Auto-optimize" checked={s.autoOptimize} hint="Moves new and unassigned bugs into the best queued or running build by itself (zero tokens), and again when the queue changes." onChange={(on) => void set({ autoOptimize: on })} />
      {num('Most bugs per build', 'maxPerBuild', 'The optimizer and the agents never put more open bugs than this on one build.')}
      {num('Match threshold', 'minScore', 'How strong a match must be before a bug is moved (words, app, area and files the build touches).')}
      <SelectField label="Builds the optimizer looks at" value={s.scope} options={[{ value: 'profile', label: 'The active build profile' }, { value: 'all', label: 'Every profile' }]} onChange={(v) => void set({ scope: v })} />
      {num('Skip builds untouched for (days)', 'freshDays', 'Old pending builds are left alone (dragging onto them still works).')}
      <Switch label="Ask AI button" checked={s.askAi} hint="Off by default: unclear matches stay with you. Asking a model costs tokens." onChange={(on) => void set({ askAi: on })} />
      <Switch label="Handoffs in the crew chat" checked={s.chat} hint="Every move is posted in the group chat; the build's agent takes it or bounces it." onChange={(on) => void set({ chat: on })} />
      <SelectField label="Chat tone" value={s.tone} options={[{ value: 'street', label: 'Street' }, { value: 'clean', label: 'Clean' }]} onChange={(v) => void set({ tone: v })} />
      <SelectField label="When bounced" value={s.whenBounced} options={[{ value: 'reroute', label: 'Auto-reroute to the next best build' }, { value: 'ask', label: 'Ask Brett' }]} onChange={(v) => void set({ whenBounced: v })} />
      {num('Bounces before asking Brett', 'bouncesBeforeAsk', 'After this many bounces in a row the bug goes back to Unassigned and waits for you.')}
      {err && <Note tone="danger">{err}</Note>}
    </div>
  );
}
