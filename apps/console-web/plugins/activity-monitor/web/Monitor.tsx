import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Chip, Container, Icon, IconButton, Segmented, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import {
  api, ago, exportLog, query, setView, useStore, viewState, when, whenFull,
  type Chain, type Ev, type Rule, type Settings, type Stats, type Tab,
} from './store';

const RANGES = [{ value: '', label: 'Any time' }, { value: '15m', label: 'Last 15 minutes' }, { value: '1h', label: 'Last hour' }, { value: '1d', label: 'Last day' }, { value: '1w', label: 'Last week' }];
const SEVS = [{ value: '', label: 'Every level' }, { value: 'info', label: 'Info and up' }, { value: 'warning', label: 'Warnings and errors' }, { value: 'error', label: 'Errors only' }];
const KINDS = ['click', 'action', 'command', 'axhub', 'approval', 'veto', 'agent', 'crew', 'orchestrator', 'build', 'session', 'error', 'fix', 'rule', 'system'];
const KIND_ICON: Record<string, string> = { click: 'grip', action: 'zap', command: 'terminal', axhub: 'cloud', approval: 'check-circle', veto: 'x-circle', agent: 'user', crew: 'user', orchestrator: 'branch', build: 'hammer', session: 'code', error: 'alert', fix: 'shield', rule: 'sliders', system: 'info' };
const SEV_TONE: Record<string, string> = { error: 'danger', warning: 'warning', success: 'success', info: '', debug: 'muted' };

/** Colour of a line: its severity when it's a problem, else its kind's colour from the settings (a token name). */
export function toneOf(e: Pick<Ev, 'kind' | 'severity'>, s: Settings | null): CSSProperties {
  const tok = SEV_TONE[e.severity] && e.severity !== 'info' ? SEV_TONE[e.severity] : (s?.colors?.[e.kind] ?? 'accent');
  return { ['--axp-am-tone' as string]: `var(--fx-${tok})` };
}

export function MonitorView() {
  const rt = useRuntime();
  const store = useStore();
  const v = store.view;
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [fmt, setFmt] = useState('jsonl');
  const listRef = useRef<HTMLDivElement>(null);
  const rev = useRef(-1);
  const s = store.settings;

  const load = useCallback(async () => {
    try {
      const r = await api.call<{ events?: Ev[]; chains?: Chain[]; matched?: string[]; total: number; rev: number; tabs: Tab[]; stats: Stats }>(`events?${query(v, { view: v.view, limit: '800' })}`);
      setTabs(r.tabs); setTotal(r.total); setErr('');
      if (r.chains) { setChains(r.chains); setMatched(new Set(r.matched)); } else setEvents(r.events ?? []);
      rev.current = r.rev;
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [v.tab, v.q, v.range, v.kind, v.minSeverity, v.app, v.view]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (v.paused) return undefined;
    const t = setInterval(() => void load(), Math.max(1000, s?.pollMs ?? 2000));
    return () => clearInterval(t);
  }, [load, v.paused, s?.pollMs]);
  // live follow: newest at the bottom stays in view
  useEffect(() => { if (v.follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [events, chains, v.follow]);

  const all = useMemo(() => (v.view === 'tree' ? chains.flatMap((c) => c.events) : events), [chains, events, v.view]);
  const sel = all.find((e) => e.id === v.selected) ?? null;
  const ordered = useMemo(() => [...chains].reverse(), [chains]); // oldest chain first, so follow keeps the newest in view

  return (
    <div className={`fx-stack fx-stack--lg axp-activity-monitor axp-activity-monitor--${s?.density ?? 'comfortable'}`}>
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Plugin</p><h1>Activity Monitor</h1></div>
        <MonitorWidget />
      </header>

      <div role="toolbar" aria-label="Activity log tools" className="axp-activity-monitor__tools" data-axp-am-skip>
        <TextField label="Search" type="search" value={v.q} placeholder="Joey rejected, axHub, build name…" onChange={(q) => setView({ q })} className="axp-activity-monitor__search" />
        <SelectField label="Time" value={v.range} options={RANGES} onChange={(range) => setView({ range })} />
        <SelectField label="Level" value={v.minSeverity} options={SEVS} onChange={(minSeverity) => setView({ minSeverity })} />
        <SelectField label="Kind" value={v.kind} empty="Every kind" options={KINDS.map((k) => ({ value: k, label: k }))} onChange={(kind) => setView({ kind })} />
        <Segmented label="Layout" value={v.view} onChange={(view) => setView({ view })} options={[{ value: 'tree', label: 'Chains', icon: 'branch' }, { value: 'flat', label: 'Lines', icon: 'list' }]} />
        <Switch label="Live follow" checked={v.follow} onChange={(follow) => setView({ follow })} />
        <Button size="sm" tone={v.paused ? 'primary' : 'neutral'} icon={v.paused ? 'play' : 'pause'} onClick={() => setView({ paused: !v.paused })}>{v.paused ? 'Resume' : 'Pause'}</Button>
        <SelectField label="Export as" value={fmt} options={[{ value: 'jsonl', label: 'JSON lines' }, { value: 'csv', label: 'CSV' }, { value: 'md', label: 'Markdown' }, { value: 'txt', label: 'Text' }]} onChange={setFmt} />
        <Button size="sm" icon="download" onClick={() => void exportLog(fmt).catch((e) => rt.toast(String(e?.message ?? e), 'danger', 'Export failed'))}>Export</Button>
        <IconButton icon="settings" label="Activity log settings" onClick={() => rt.dispatch('settings.open:activity-monitor')} />
      </div>

      <TabGroup id="activity-monitor.tabs" label="Activity log sections" value={v.tab} onChange={(tab) => setView({ tab, selected: '' })}
        tabs={tabs.map((t) => ({ value: t.id, label: t.label, badge: t.count || undefined, icon: t.id === 'errors' ? 'alert' : t.id === 'axhub' ? 'cloud' : t.id.startsWith('app:') ? 'box' : undefined }))}
        extra={<span className="axp-activity-monitor__count">{total} shown{v.paused ? ' · paused' : ''}</span>} />

      {err && <p className="axp-activity-monitor__err" role="alert">{err}</p>}

      <div className="axp-activity-monitor__panes" data-axp-am-skip>
        <Container title={v.view === 'tree' ? 'What happened, one request at a time' : 'What happened'} icon="list" collapsible className="axp-activity-monitor__logpane">
          <div ref={listRef} className="axp-activity-monitor__log" role="log" aria-live={v.follow && !v.paused ? 'polite' : 'off'} aria-label="Activity log">
            {v.view === 'tree'
              ? ordered.map((c) => <ChainRow key={c.chain} c={c} matched={matched} settings={s} selected={v.selected} open={v.open[c.chain] ?? c.count <= 12} />)
              : events.map((e) => <EventRow key={e.id} e={e} settings={s} selected={v.selected === e.id} />)}
            {!all.length && !err && <p className="axp-activity-monitor__empty">Nothing here yet. Taps, actions, builds, axHub runs and errors show up as they happen.</p>}
          </div>
        </Container>
        <Container title={sel ? 'Event' : 'Pick an event'} icon="eye" collapsible className="axp-activity-monitor__detailpane">
          {sel ? <EventDetail e={sel} settings={s} onChanged={() => void load()} /> : <p className="axp-activity-monitor__empty">Select any line to see who did what, open what it touched, retry it or make a rule for next time.</p>}
        </Container>
      </div>

      <RulesPane />
    </div>
  );
}

function ChainRow({ c, matched, settings, selected, open }: { c: Chain; matched: Set<string>; settings: Settings | null; selected: string; open: boolean }) {
  const toggle = () => setView({ open: { ...viewState().open, [c.chain]: !open } });
  const rest = c.events.slice(1);
  return (
    <div className={`axp-activity-monitor__chain ${open ? 'is-open' : ''}`} style={toneOf({ kind: c.root.kind, severity: c.severity }, settings)}>
      <div className="axp-activity-monitor__chainhead">
        {rest.length > 0
          ? <IconButton icon={open ? 'chevron-down' : 'chevron-right'} label={open ? 'Fold this request' : `Show the ${rest.length} things that followed`} onClick={toggle} />
          : <span className="axp-activity-monitor__twisty" aria-hidden="true" />}
        <EventRow e={c.root} settings={settings} selected={selected === c.root.id} dim={matched.size > 0 && !matched.has(c.root.id)} extra={rest.length ? <Chip>{rest.length} more</Chip> : null} />
      </div>
      {open && rest.length > 0 && (
        <ul className="axp-activity-monitor__tree">
          {rest.map((e) => (
            <li key={e.id} style={{ ['--axp-am-depth' as string]: String(Math.max(1, e.depth ?? 1)) }}>
              <EventRow e={e} settings={settings} selected={selected === e.id} dim={matched.size > 0 && !matched.has(e.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventRow({ e, settings, selected, dim, extra }: { e: Ev; settings: Settings | null; selected: boolean; dim?: boolean; extra?: ReactNode }) {
  return (
    <button type="button" data-fx-row className={`axp-activity-monitor__row axp-activity-monitor__row--${e.severity} ${selected ? 'is-selected' : ''} ${dim ? 'is-dim' : ''}`}
      style={toneOf(e, settings)} aria-pressed={selected} onClick={() => setView({ selected: selected ? '' : e.id })} title={whenFull(e.at)}>
      <span className="axp-activity-monitor__time">{when(e.at)}</span>
      <span className="axp-activity-monitor__icon"><Icon name={KIND_ICON[e.kind] ?? 'info'} size={14} /></span>
      <span className="axp-activity-monitor__kind">{e.kind}</span>
      <span className="axp-activity-monitor__text">{e.sentence}</span>
      {e.app !== 'console' && <span className="axp-activity-monitor__app">{e.app}</span>}
      {extra}
    </button>
  );
}

function EventDetail({ e, settings, onChanged }: { e: Ev; settings: Settings | null; onChanged: () => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const facts: [string, string | undefined][] = [
    ['When', `${whenFull(e.at)} (${ago(e.at)})`], ['App', e.app], ['Kind', e.kind], ['Level', e.severity], ['Who', e.actor], ['What', e.object],
    ['To whom', e.target], ['Through', e.via], ['Result', e.result], ['Why', e.reason], ['Source', e.source], ['Request', e.chain],
  ];
  const retry = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ done?: boolean; action?: string; how?: string }>(`retry/${encodeURIComponent(e.id)}`);
      if (r.action) rt.dispatch(r.action);
      rt.toast(r.how ?? 'Retried', r.done || r.action ? 'success' : 'warning', 'Retry');
      onChanged();
    } catch (x) { rt.toast(String((x as Error)?.message ?? x), 'danger', 'Retry failed'); } finally { setBusy(false); }
  };
  const open = (r = e.ref) => { if (r?.action) rt.dispatch(r.action); else if (r?.url) window.open(r.url, '_blank', 'noopener'); };
  return (
    <div className="axp-activity-monitor__detail" style={toneOf(e, settings)}>
      <p className="axp-activity-monitor__sentence">{e.sentence}</p>
      <dl className="axp-activity-monitor__facts">
        {facts.filter(([, val]) => val).map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
      </dl>
      <div role="toolbar" aria-label="Act on this event" className="axp-activity-monitor__acts">
        <Button size="sm" icon="refresh" busy={busy} onClick={() => void retry()}>Retry</Button>
        <Button size="sm" icon="external" disabled={!e.ref?.action && !e.ref?.url} onClick={() => open()}>Open{e.ref?.label ? ` ${e.ref.label.slice(0, 30)}` : ''}</Button>
        <Button size="sm" icon="file" disabled={!e.fixNote?.action && !e.fixNote?.id} onClick={() => open(e.fixNote?.action ? e.fixNote : { action: `codebase-changes.open:${e.fixNote?.id ?? ''}` })}>Fix note</Button>
        <Button size="sm" icon="branch" disabled={!e.chain} onClick={() => setView({ tab: 'all', q: '', view: 'tree', open: { ...viewState().open, [e.chain ?? '']: true } })}>Whole request</Button>
        <Button size="sm" tone="primary" icon="sliders" onClick={() => setMaking(!making)}>Make a rule</Button>
      </div>
      {making && <RuleForm from={e} onDone={() => { setMaking(false); onChanged(); }} />}
      {e.raw !== undefined && (
        <details className="axp-activity-monitor__raw">
          <summary>Raw detail</summary>
          <pre className="fx-mono">{JSON.stringify(e.raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

const DO_OPTIONS = [
  { value: 'notify', label: 'Notify me (console + phone)' }, { value: 'fix', label: 'Run the fix (retry, or a systems check)' },
  { value: 'route', label: 'Send it to an agent (through the orchestrator)' }, { value: 'action', label: 'Run a console action' }, { value: 'note', label: 'Only note it' },
];

export function RuleForm({ from, rule, onDone }: { from?: Ev; rule?: Rule; onDone: () => void }) {
  const rt = useRuntime();
  const on0 = rule?.on ?? { kind: from?.kind ?? '', app: from?.app ?? '', severity: from && ['warning', 'error'].includes(from.severity) ? from.severity : '', text: (from?.reason || from?.object || '').slice(0, 80) };
  const [on, setOn] = useState<Record<string, string>>(on0);
  const [doo, setDo] = useState<Record<string, string>>(rule?.do ?? { type: 'notify' });
  const [name, setName] = useState(rule?.name ?? '');
  const [test, setTest] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const body = () => ({ id: rule?.id, name: name || undefined, on: Object.fromEntries(Object.entries(on).filter(([, x]) => x)), do: doo, from: from?.id ?? rule?.from });
  const save = async () => {
    try { await api.post('rules', body()); rt.toast('Rule saved. It runs the next time this happens.', 'success', 'Activity rule'); onDone(); } catch (x) { setErr(String((x as Error)?.message ?? x)); }
  };
  const tryIt = async () => { try { setTest((await api.post<{ matches: number }>('rules/test', body())).matches); setErr(''); } catch (x) { setErr(String((x as Error)?.message ?? x)); } };
  const set = (k: string) => (val: string) => setOn({ ...on, [k]: val });
  return (
    <div className="axp-activity-monitor__ruleform">
      <p className="axp-activity-monitor__rulelead">When this happens again…</p>
      <div className="axp-activity-monitor__grid">
        <SelectField label="Kind" value={on.kind ?? ''} empty="Any kind" options={KINDS.map((k) => ({ value: k, label: k }))} onChange={set('kind')} />
        <TextField label="App" value={on.app ?? ''} placeholder="any app" onChange={set('app')} />
        <SelectField label="Level" value={on.severity ?? ''} empty="Any level" options={['info', 'success', 'warning', 'error'].map((x) => ({ value: x, label: x }))} onChange={set('severity')} />
        <TextField label="Who" value={on.actor ?? ''} placeholder="anyone" onChange={set('actor')} />
        <TextField label="Text it contains" value={on.text ?? ''} onChange={set('text')} />
      </div>
      <p className="axp-activity-monitor__rulelead">…do that</p>
      <div className="axp-activity-monitor__grid">
        <SelectField label="Do" value={doo.type ?? 'notify'} options={DO_OPTIONS} onChange={(type) => setDo({ ...doo, type })} />
        {doo.type === 'route' && <TextField label="Agent" value={doo.agent ?? ''} placeholder="Patches, Vinny, Mosses…" onChange={(agent) => setDo({ ...doo, agent })} />}
        {doo.type === 'action' && <TextField label="Console action" mono value={doo.action ?? ''} placeholder="nav:builds" onChange={(action) => setDo({ ...doo, action })} />}
        {doo.type === 'fix' && <TextField label="Systems check id (optional)" mono value={doo.check ?? ''} onChange={(check) => setDo({ ...doo, check })} />}
        <TextField label="Message" value={doo.message ?? ''} placeholder="what to say" onChange={(message) => setDo({ ...doo, message })} />
        <TextField label="Rule name" value={name} placeholder="written for you when empty" onChange={setName} />
      </div>
      {err && <p className="axp-activity-monitor__err" role="alert">{err}</p>}
      <div role="toolbar" aria-label="Rule" className="axp-activity-monitor__acts">
        <Button size="sm" icon="eye" onClick={() => void tryIt()}>Test{test !== null ? ` (${test} recent match${test === 1 ? '' : 'es'})` : ''}</Button>
        <Button size="sm" tone="primary" icon="save" onClick={() => void save()}>Save rule</Button>
        <Button size="sm" tone="quiet" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export function RulesPane() {
  const rt = useRuntime();
  const [rules, setRules] = useState<Rule[]>([]);
  const [edit, setEdit] = useState('');
  const load = useCallback(() => api.call<{ rules: Rule[] }>('rules').then((r) => setRules(r.rules), () => setRules([])), []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (r: Rule, enabled: boolean) => { await api.post('rules', { ...r, enabled }); void load(); };
  const del = async (r: Rule) => { try { await api.del(`rules/${encodeURIComponent(r.id)}`); void load(); } catch (x) { rt.toast(String((x as Error)?.message ?? x), 'danger', 'Delete failed'); } };
  return (
    <Container title={`Rules (${rules.length})`} icon="sliders" collapsible defaultOpen={rules.length > 0} className="axp-activity-monitor__rules">
      {!rules.length && <p className="axp-activity-monitor__empty">No rules yet. Select any event and tap Make a rule: when it happens again, the log notifies you, runs the fix, sends it to an agent or runs a console action.</p>}
      <ul className="axp-activity-monitor__rulelist">
        {rules.map((r) => (
          <li key={r.id} className="axp-activity-monitor__rule">
            <div className="axp-activity-monitor__rulehead">
              <Switch label={r.name} hideLabel checked={r.enabled} onChange={(on) => void toggle(r, on)} />
              <span className="axp-activity-monitor__text">{r.name}</span>
              <span className="axp-activity-monitor__time">{r.hits} hit{r.hits === 1 ? '' : 's'}{r.lastHit ? ` · last ${ago(r.lastHit)}` : ''}</span>
              <IconButton icon="edit" label={`Edit ${r.name}`} onClick={() => setEdit(edit === r.id ? '' : r.id)} />
              <Button size="sm" tone="danger" icon="trash" confirm={`Delete the rule “${r.name}”?`} onClick={() => void del(r)}>Delete</Button>
            </div>
            {edit === r.id && <RuleForm rule={r} onDone={() => { setEdit(''); void load(); }} />}
          </li>
        ))}
      </ul>
    </Container>
  );
}

/** The widget for banners and toolbars: live count today, errors, the last error; tap to open the log. */
export function MonitorWidget({ compact }: { compact?: boolean }) {
  const rt = useRuntime();
  const s = useStore().stats;
  if (!s) return null;
  const le = s.lastError;
  return (
    <div role="toolbar" aria-label="Activity log summary" className={`axp-activity-monitor__widget ${compact ? 'is-compact' : ''}`}>
      <Button size="sm" tone="ghost" icon="monitor" title="Open the activity log" onClick={() => rt.dispatch('activity-monitor.open')}>{s.today} today</Button>
      {s.errors > 0 && <Button size="sm" tone="danger" icon="alert" title={le ? `${le.sentence} (${ago(le.at)})` : 'Errors today'} onClick={() => rt.dispatch(`activity-monitor.tab:errors`)}>{s.errors} error{s.errors === 1 ? '' : 's'}</Button>}
      {!compact && le && <span className="axp-activity-monitor__lasterr" title={whenFull(le.at)}>Last error {ago(le.at)}: {le.sentence}</span>}
    </div>
  );
}
