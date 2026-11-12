/**
 * Auto-fixes console plugin (ai.amberx.axf.console.auto-fixes): every call that failed and is being fixed on the
 * server (retry-ladder@1), live. Brett picks how it shows (Settings → Plugins → Auto-fixes, or REST/MCP/CLI/voice):
 *   banner  its own strip across the top (only while something is being fixed or gave up)
 *   widget  a badge on the banner bar (snappable like every banner widget), with the count
 *   off     nothing on the banner; the Auto-fixes page still lists everything
 * The setting lives on the server (GET/POST /api/plugins/auto-fixes/settings), so a change from anywhere switches every
 * open console (and the Molly banner strip, which draws this console's banners) on the next poll.
 */
import { useEffect, useState } from 'react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Container, SelectField, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './auto-fixes.css';

const ID = 'ai.amberx.axf.console.auto-fixes';
const FOLDER = 'auto-fixes';
export const VIEW = 'auto-fixes';
const WIDGET_KEY = 'badge:auto-fixes';
type Display = 'banner' | 'widget' | 'off';

interface Row { id: string; title: string; source: string; status: 'retrying' | 'fixed' | 'gave-up' | 'failed'; kind: string; error: string; now: string; attempts: number; missing: string[]; updatedAt: string }
interface State { display: Display; count: number; retrying: number; gaveUp: number; rows: Row[] }
interface JobOut { job: { attempts: unknown[] }; log: string; amberxNote: string }

/* ---------------- one shared store: banner, widget, page and settings read the same poll ---------------- */
let st: State | null = null;
let runtime: AxfRuntime | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let selected = '';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

async function poll() {
  try {
    const r = await pluginFetch(FOLDER, 'state');
    if (r.status === 404) { st = null; emit(); paintWidget(); return; } // switched off
    st = (await r.json()) as State;
  } catch { /* keep the last answer */ }
  emit(); paintWidget();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void poll(), st?.retrying ? 4000 : 20000); // live while something is being fixed
}

function useAutoFixes(): State | null {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return st;
}

/** Open the page on one job (a row tap, the widget's tap). */
function openJob(rt: AxfRuntime, id = '') { selected = id; emit(); rt.navigate(VIEW); }

/* ---------------- the banner widget (display = widget) ---------------- */
function paintWidget() {
  const rt = runtime; if (!rt) return;
  if (!st || st.display !== 'widget') { rt.detachFromBanner(WIDGET_KEY); return; }
  const tone = st.gaveUp ? 'danger' : st.retrying ? 'warning' : 'success';
  rt.registry.register({
    $axf: 'asset@1', type: 'badge', id: 'auto-fixes', name: 'Auto-fixes', version: '0.1.0', author: 'Auto-fixes plugin',
    description: 'Calls that failed and are being fixed automatically; attached to the banner by the Auto-fixes plugin.', tags: ['status', 'auto-fixes'],
    data: { icon: st.count ? 'hammer' : 'check', label: st.count ? String(st.count) : 'Auto-fixes', tone,
      tooltip: st.count ? `${st.retrying} being fixed, ${st.gaveUp} gave up` : 'Nothing failing', link: 'auto-fixes.open' },
  } as never, 'app', ID);
  rt.attachToBanner({ type: 'badge', id: 'auto-fixes', at: 'end', order: 40, origin: ID, widget: { label: 'Auto-fixes', priority: 7, aliases: ['auto fixes', 'retries', 'failing'] } } as never);
}

/* ---------------- the full banner (display = banner) ---------------- */
function RowLine({ r, onOpen }: { r: Row; onOpen: () => void }) {
  return (
    <button type="button" className="fx-btn fx-btn--ghost axp-autofix__row" data-status={r.status} onClick={onOpen} data-help="auto-fixes.row">
      <span className="axp-autofix__title">{r.title}</span>
      <span className="axp-autofix__now">{r.now}</span>
      <span className="axp-autofix__meta">{r.attempts} attempt{r.attempts === 1 ? '' : 's'}{r.status === 'gave-up' && r.missing.length ? ` · missing: ${r.missing.join('; ')}` : ''}</span>
    </button>
  );
}

function AutoFixesBanner() {
  const rt = useRuntime();
  const s = useAutoFixes();
  if (!s || s.display !== 'banner' || !s.count) return null;
  const open = s.rows.filter((r) => r.status === 'retrying' || r.status === 'gave-up');
  return (
    <div className="axp-autofix-banner" role="status" aria-live="polite" data-help="auto-fixes.banner" data-axf-not-banner="the content of the auto-fixes BannerDef; the framework banner frame draws the banner">
      <Button icon="hammer" onClick={() => openJob(rt)}>{`Auto-fixes ${s.count}`}</Button>
      <div className="axp-autofix-banner__rows">{open.slice(0, 3).map((r) => <RowLine key={r.id} r={r} onOpen={() => openJob(rt, r.id)} />)}</div>
      {open.length > 3 && <span className="axp-autofix__meta">{`+${open.length - 3} more`}</span>}
    </div>
  );
}

/* ---------------- the page ---------------- */
function JobLog({ id }: { id: string }) {
  const [j, setJ] = useState<JobOut | null>(null);
  const s = useAutoFixes();
  const stamp = s?.rows.find((r) => r.id === id)?.updatedAt ?? '';
  useEffect(() => { void pluginFetch(FOLDER, `jobs/${encodeURIComponent(id)}`).then((r) => r.json()).then((x: JobOut) => setJ(x), () => setJ(null)); }, [id, stamp]);
  if (!j) return null;
  return (
    <Container title="Automatic fixes log" icon="list">
      <pre className="axp-autofix__log">{j.log}</pre>
      {j.amberxNote && <p className="axp-autofix__meta">{`In AmberX: Automatic fixes list (note ${j.amberxNote})`}</p>}
    </Container>
  );
}

function AutoFixesView() {
  const s = useAutoFixes();
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); void poll(); return () => { listeners.delete(f); }; }, []);
  const dismiss = (id: string) => void pluginFetch(FOLDER, 'dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).then(() => poll());
  const pick = (id: string) => { selected = selected === id ? '' : id; emit(); };
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>Auto-fixes</h1></div></header>
      <Container title={s ? `${s.retrying} being fixed · ${s.gaveUp} gave up` : 'Loading…'} icon="hammer">
        {!s?.rows.length && <p>Nothing has needed a fix.</p>}
        <div className="fx-stack">
          {s?.rows.map((r) => (
            <div key={r.id} className="fx-row axp-autofix__item" data-selected={r.id === selected || undefined}>
              <RowLine r={r} onOpen={() => pick(r.id)} />
              {r.status === 'gave-up' && <Button icon="x" onClick={() => dismiss(r.id)}>Dismiss</Button>}
            </div>
          ))}
        </div>
      </Container>
      {selected && <JobLog id={selected} />}
    </div>
  );
}

/* ---------------- settings ---------------- */
function DisplaySetting() {
  const s = useAutoFixes();
  const set = (display: string) => void pluginFetch(FOLDER, 'settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display }) }).then(() => poll());
  return (
    <SelectField label="Show it as" value={s?.display ?? 'banner'} onChange={set} hint="Its own banner across the top, or a widget on the banner bar. Switches live in every open console."
      options={[{ value: 'banner', label: 'Full banner (a strip across the top)' }, { value: 'widget', label: 'Banner widget (a badge on the banner bar)' }, { value: 'off', label: 'Off (page only)' }]} />
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Auto-fixes',
  version: '0.1.0',
  appMenu,
  views: { [VIEW]: { title: 'Auto-fixes', icon: 'hammer', render: () => <AutoFixesView /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Auto-fixes', icon: 'hammer', view: VIEW }] },
  banners: [{ id: 'auto-fixes', order: 30, label: 'Auto-fixes', icon: 'hammer', settingsTab: FOLDER, render: () => <AutoFixesBanner /> }],
  settingsTabs: [{ id: FOLDER, label: 'Auto-fixes', icon: 'hammer', order: 60, parent: 'plugins' }],
  settingsPanels: [
    { id: 'auto-fixes.display', tab: FOLDER, title: 'Display', icon: 'layout', order: 10, render: () => <DisplaySetting /> },
    { id: 'auto-fixes.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    runtime = rt;
    rt.actions.register('auto-fixes.open', () => openJob(rt), { label: 'Auto-fixes: open' });
    void poll();
  },
};
