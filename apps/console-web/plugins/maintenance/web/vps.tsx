/**
 * The VPS plugin's live parts (Brett, Nov 10 2026: "gauges and meter widgets for the VPS … a banner widget … if it's icon
 * only, the colours represent the load and the space … click the banner items, a drop-down showing all the gauges").
 *
 * - One shared read of GET /gauges, every `refreshS` seconds while the page is visible and something shows it.
 * - Status tab: radial gauges, bars, a compact strip or history sparklines (remembered on the server, PUT /vps/settings),
 *   then load 1/5/15, every filesystem, Docker per container and the top processes.
 * - Banner widget: one badge per chosen metric (icon only, icon + value, or icon + mini meter). Icon-only colour follows
 *   the level on the heat scale: two theme tokens mixed, written as one rule per badge (no literal colours).
 * - Dropdown (slot app.frame.cover): every gauge, a dot in its heat colour, name, %, values and what it is; live, the
 *   tapped one highlighted, footer Open VPS plugin and Quick clean-up.
 * - VPS tools tab: the `vps.tools` slot (other plugins add their VPS parts there) and every view or settings tab in the
 *   console that is about the server, found by what it says it is (no plugin folder names).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, Chip, Container, Gauge, Icon, Meter, Note, Segmented, Slot, useIsPhone, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';
import { aboutOf, badgeId, heatCss, iconOf, miniMeter, pctText, shortName, valueText, VIEWS, type Gauges, type HistoryPoint, type Metric, type VpsSettings } from './vpsmodel';

export const FOLDER = 'maintenance';
export const ORIGIN = 'ai.amberx.axf.console.maintenance';
export const TOOLS_SLOT = 'vps.tools';
const P = 'axp-vps';
const api = pluginApi(FOLDER, 'VPS', { unavailable: 'The VPS plugin is switched off or its server part is not running.' });

/* ---------------- one shared read ---------------- */

let g: { data: Gauges | null; error: string } = { data: null, error: '' };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let banner = false;
let rtRef: AxfRuntime | null = null;

export async function readGauges(): Promise<Gauges | null> {
  try { g = { data: await api.call<Gauges>('gauges'), error: '' }; } catch (e) { g = { ...g, error: (e as Error).message }; }
  if (rtRef) paintBanner(rtRef);
  subs.forEach((f) => f());
  return g.data;
}
function schedule() {
  if (timer) clearTimeout(timer);
  if (!subs.size && !banner) { timer = null; return; }
  const ms = Math.max(5, g.data?.settings.refreshS ?? 15) * 1000;
  timer = setTimeout(() => { if (document.visibilityState === 'visible') void readGauges().finally(schedule); else schedule(); }, ms);
}
function subscribe(f: () => void) {
  subs.add(f);
  if (!g.data) void readGauges();
  schedule();
  return () => { subs.delete(f); if (!subs.size) schedule(); };
}
const snap = () => g;
export const useGauges = () => useSyncExternalStore(subscribe, snap);

export async function saveVps(patch: Partial<VpsSettings>): Promise<void> {
  const r = await api.put<{ settings: VpsSettings }>('vps/settings', patch);
  if (g.data) g = { ...g, data: { ...g.data, settings: r.settings } };
  await readGauges();
}

/* ---------------- Status tab ---------------- */

const tone = (m: Metric) => (m.level === 'high' ? 'danger' : m.level === 'warn' ? 'warning' : 'success');

function Spark({ points, id }: { points: HistoryPoint[]; id: string }) {
  const vals = points.map((p) => p[id]).filter((v): v is number => typeof v === 'number');
  if (vals.length < 2) return <span className="fx-small fx-muted">collecting…</span>;
  const w = 100; const h = 24;
  const d = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (Math.max(0, Math.min(100, v)) / 100) * h}`).join(' ');
  return <svg className={`${P}__spark`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${id} over the last ${vals.length} readings`}><polyline points={d} /></svg>;
}

function Dot({ m }: { m: Metric }) {
  return <span className={`${P}__dot`} style={{ background: heatCss(m.heat) }} aria-hidden="true" />;
}

function MetricsView({ data, view }: { data: Gauges; view: VpsSettings['view'] }) {
  const ms = data.metrics;
  if (view === 'radial') {
    return <div className={`${P}__radial`}>{ms.map((m) => <Gauge key={m.id} label={`${m.label} · ${valueText(m)}`} value={m.pct ?? 0} max={100} unit="%" />)}</div>;
  }
  if (view === 'strip') {
    return (
      <div className={`${P}__strip`} role="list" aria-label="Gauges">
        {ms.map((m) => <span key={m.id} role="listitem" className={`${P}__stripitem`}><Dot m={m} /><b>{shortName(m)}</b> {pctText(m)}</span>)}
      </div>
    );
  }
  return (
    <ul className={`${P}__rows`} aria-label="Gauges">
      {ms.map((m) => (
        <li key={m.id} className={`${P}__row`}>
          <span className={`${P}__name`}><Dot m={m} /><Icon name={iconOf(m.id)} size={14} /> {m.label}</span>
          <span className={`${P}__bar`}>{view === 'history' ? <Spark points={data.history} id={m.id} /> : <Meter value={m.pct ?? 0} label={`${m.label} ${pctText(m)}`} />}</span>
          <Chip tone={tone(m)}>{pctText(m)}</Chip>
          <span className={`${P}__val fx-small fx-muted`}>{valueText(m)}</span>
        </li>
      ))}
    </ul>
  );
}

const gbs = (n: number) => `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB`;
const mbs = (n: number) => (n >= 1024 ** 3 ? gbs(n) : `${Math.round(n / 1024 ** 2)} MB`);

export function StatusTab() {
  const { data, error } = useGauges();
  const [busy, setBusy] = useState(false);
  if (error && !data) return <Note tone="danger">{error}</Note>;
  if (!data) return <p className="fx-small fx-muted">Reading the VPS…</p>;
  const s = data.settings;
  return (
    <div className="fx-stack">
      <div className={`${P}__bar-row`} role="toolbar" aria-label="Gauge view">
        <Segmented label="View" value={s.view} options={VIEWS.map((v) => ({ value: v.value, label: v.label, icon: v.icon }))} onChange={(v) => void saveVps({ view: v })} />
        <span className="fx-small fx-muted fx-grow">Every {s.refreshS} s · thresholds {s.warnPct}% / {s.highPct}% · {data.source === 'host' ? 'host part' : 'console container'}</span>
        <Button size="sm" icon="refresh" busy={busy} onClick={() => { setBusy(true); void readGauges().finally(() => setBusy(false)); }}>Read now</Button>
      </div>
      <MetricsView data={data} view={s.view} />
      <Container title={`Load · ${data.cpus} CPUs`} icon="zap" collapsible defaultOpen>
        <div className={`${P}__load`}>
          {(['1', '5', '15'] as const).map((k) => (
            <div key={k} className={`${P}__loadcell`}>
              <span className="fx-small fx-muted">{k} min</span>
              <Meter value={Math.min(100, ((data.load[k] ?? 0) / (data.cpus || 1)) * 100)} label={`Load ${k} min`} small />
              <b>{data.load[k] ?? '?'}</b>
            </div>
          ))}
        </div>
      </Container>
      <Container title={`Filesystems · ${data.disks.length}`} icon="save" collapsible defaultOpen>
        <ul className={`${P}__rows`} aria-label="Filesystems">
          {data.disks.map((d) => (
            <li key={d.mount} className={`${P}__row`}>
              <span className={`${P}__name`}><b>{d.mount}</b> <span className="fx-small fx-muted fx-mono">{d.device} · {d.fs}</span></span>
              <span className={`${P}__bar`}><Meter value={d.pct} label={`${d.mount} ${d.pct}%`} /></span>
              <Chip tone={d.pct >= s.highPct ? 'danger' : d.pct >= s.warnPct ? 'warning' : 'success'}>{Math.round(d.pct)}%</Chip>
              <span className={`${P}__val fx-small fx-muted`}>{gbs(d.used)} / {gbs(d.total)} · {gbs(d.free)} free</span>
            </li>
          ))}
        </ul>
      </Container>
      <Container title={`Docker · ${data.containers.length} running`} icon="box" collapsible defaultOpen={false}>
        {data.containers.length ? (
          <ul className={`${P}__rows`} aria-label="Containers">
            {data.containers.map((c) => (
              <li key={c.name} className={`${P}__row`}>
                <span className={`${P}__name fx-mono fx-small`}>{c.name}</span>
                <span className={`${P}__bar`}><Meter value={Math.min(100, c.cpu ?? 0)} label={`${c.name} CPU`} small /></span>
                <span className="fx-small">CPU {c.cpu ?? '?'}%</span>
                <span className={`${P}__val fx-small fx-muted`}>RAM {mbs(c.mem)} ({c.memPct ?? '?'}%)</span>
              </li>
            ))}
          </ul>
        ) : <p className="fx-small fx-muted">No container stats here: Docker isn't reachable from the console and the host part hasn't reported them.</p>}
      </Container>
      <Container title="Top processes" icon="list" collapsible defaultOpen={false}>
        <ul className={`${P}__rows`} aria-label="Top processes">
          {data.top.map((p) => (
            <li key={p.pid} className={`${P}__row`}>
              <span className={`${P}__name fx-mono fx-small`}>{p.name} <span className="fx-muted">#{p.pid}</span></span>
              <span className="fx-small">CPU {p.cpu}%</span>
              <span className={`${P}__val fx-small fx-muted`}>RAM {mbs(p.rss)} ({p.memPct}%)</span>
            </li>
          ))}
        </ul>
      </Container>
    </div>
  );
}

/* ---------------- banner widget ---------------- */

const placed = new Map<string, string>();
const dropActions = new Set<string>();
let styleEl: HTMLStyleElement | null = null;

function badgeAsset(m: Metric, s: VpsSettings, load: Record<string, number>) {
  const label = s.bannerMode === 'value' ? pctText(m) : s.bannerMode === 'meters' ? miniMeter(m.pct) : shortName(m);
  return {
    $axf: 'asset@1', type: 'badge', id: badgeId(m.id), name: `VPS ${m.label}`, version: '0.1.0', author: 'VPS plugin',
    description: `The VPS ${m.label.toLowerCase()} gauge on the banner. Attached by the VPS plugin.`, tags: ['vps', 'status'],
    data: { icon: iconOf(m.id), label, shape: s.bannerMode === 'icon' ? 'icon' : 'pill', tone: 'neutral', tooltip: `${m.label} ${pctText(m)} · ${valueText(m)} · ${aboutOf(m, load)}`, link: `vps.drop.${m.id}` },
  };
}

/** Each icon's colour: one rule per badge, the heat mix of two theme tokens (works in the banner, the ⋯ menu and title bars). */
function paintHeat(ms: Metric[]) {
  if (typeof document === 'undefined') return;
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = `${P}-heat`; document.head.appendChild(styleEl); }
  styleEl.textContent = ms.map((m) => `[data-axf-banner-item="badge:${badgeId(m.id)}"] .fx-banner__badge { color: ${heatCss(m.heat)}; }`).join('\n');
}

export function paintBanner(rt: AxfRuntime) {
  const d = g.data;
  const s = d?.settings;
  const want = s?.bannerShow ? d!.metrics.filter((m) => s.bannerMetrics.includes(m.id)) : [];
  const keep = new Set(want.map((m) => badgeId(m.id)));
  for (const id of [...placed.keys()]) if (!keep.has(id)) { rt.detachFromBanner(`badge:${id}`); placed.delete(id); }
  if (!d || !s) return;
  for (const m of d.metrics) if (!dropActions.has(m.id)) { dropActions.add(m.id); rt.actions.register(`vps.drop.${m.id}`, () => openDrop(m.id), { label: `VPS: ${m.label} gauge dropdown` }); }
  want.forEach((m, i) => {
    const id = badgeId(m.id);
    rt.registry.register(badgeAsset(m, s, d.load) as never, 'app', ORIGIN);
    const where = `${s.bannerSide}:${40 + i}`;
    if (placed.get(id) === where) return;
    if (placed.has(id)) rt.detachFromBanner(`badge:${id}`);
    placed.set(id, where);
    rt.attachToBanner({ type: 'badge', id, at: s.bannerSide, order: 40 + i, origin: ORIGIN, widget: { label: `VPS ${m.label}`, icon: iconOf(m.id), priority: 5, size: s.bannerMode === 'icon' ? 'icon' : 'compact', aliases: ['vps', `vps ${shortName(m).toLowerCase()}`] } });
  });
  paintHeat(want);
}

/** Start or stop the widget's own reads (the banner shows it even with no page open). */
export function startBanner(rt: AxfRuntime) {
  rtRef = rt;
  banner = true;
  void readGauges().finally(schedule);
}

/* ---------------- the dropdown ---------------- */

let drop: { metric: string; top: number; left: number } | null = null;
const dropSubs = new Set<() => void>();
let pressed: Element | null = null;
const setDrop = (d: typeof drop) => { drop = d; dropSubs.forEach((f) => f()); };

export function trackPress() {
  document.addEventListener('pointerdown', (e) => { pressed = (e.target as Element | null)?.closest?.('[data-axf-banner-item]') ?? null; }, true);
}

export function openDrop(metric: string) {
  if (drop?.metric === metric) { setDrop(null); return; }
  const r = pressed?.getBoundingClientRect();
  const w = Math.min(360, globalThis.innerWidth - 16);
  setDrop({ metric, top: r?.bottom ?? 48, left: Math.max(8, Math.min((r?.right ?? w) - w, globalThis.innerWidth - w - 8)) });
  void readGauges();
}
export const closeDrop = () => setDrop(null);
export const dropState = () => (drop ? { open: true, metric: drop.metric } : { open: false });

export function VpsDrop() {
  const rt = useRuntime();
  const phone = useIsPhone();
  const [, tick] = useState(0);
  const { data } = useGauges();
  useEffect(() => { const f = () => tick((n) => n + 1); dropSubs.add(f); return () => { dropSubs.delete(f); }; }, []);
  useEffect(() => {
    if (!drop) return undefined;
    const off = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.(`.${P}__drop, [data-axf-banner-item^="badge:vps-"]`)) setDrop(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrop(null); };
    document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key); };
  });
  const d = drop;
  if (!d || !data) return null;
  const go = (tab: string) => { setDrop(null); rt.dispatch(`vps.tab.${tab}`); };
  return createPortal(
    <div className={`fx-popover fx-dropdown ${P}__drop`} style={phone ? { top: d.top } : { top: d.top, left: d.left }} role="dialog" aria-label="VPS gauges" data-fx-overlay="" data-axf-search="off">
      <ul className={`${P}__droplist`} aria-label="Every gauge">
        {data.metrics.map((m) => (
          <li key={m.id} className={`${P}__droprow`} data-on={m.id === d.metric ? 'on' : undefined}>
            <Dot m={m} />
            <b className={`${P}__dropname`}>{m.label}</b>
            <span className={`${P}__droppct`}>{pctText(m)}</span>
            <span className="fx-small fx-muted">{valueText(m)} · {aboutOf(m, data.load)}</span>
          </li>
        ))}
      </ul>
      <div className={`${P}__dropfoot`} role="toolbar" aria-label="VPS">
        <Button size="sm" icon="monitor" onClick={() => go('status')}>Open VPS plugin</Button>
        <Button size="sm" icon="trash" tone="ghost" onClick={() => go('cleanup')}>Quick clean-up</Button>
        <span className="fx-small fx-muted fx-grow">{new Date(data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- VPS tools: everything else about the server, in one place ---------------- */

const ABOUT_SERVER = /\b(vps|server|docker|container|swap|disk|coolify|hostinger|terminal|agent cap|slots|ssh|host)\b/i;

export function ToolsTab() {
  const rt = useRuntime();
  const own = new Set(['maintenance', 'vps']);
  const views = rt.libraries.flatMap((l) => (l.ui?.views ?? []).filter((v) => !own.has(v.id) && ABOUT_SERVER.test(`${v.title} ${v.id}`)).map((v) => ({ key: `v:${v.id}`, label: v.title, icon: v.icon ?? 'monitor', from: l.label, go: () => rt.navigate(v.id) })));
  const tabs = rt.libraries.flatMap((l) => (l.ui?.settingsTabs ?? []).filter((t) => !own.has(t.id) && ABOUT_SERVER.test(`${t.label} ${t.id} ${l.label}`)).map((t) => ({ key: `t:${t.id}`, label: `${t.label} settings`, icon: 'settings', from: l.label, go: () => rt.dispatch(`settings.open:${t.id}`) })));
  return (
    <div className="fx-stack">
      <Slot name={TOOLS_SLOT} props={{}} />
      <Container title="Everywhere else the VPS shows up" icon="external">
        <p className="fx-small fx-muted" style={{ margin: 0 }}>Every page and settings tab in the console that is about the server, found by what it says it is. Plugins that add their VPS parts above move here completely.</p>
        <ul className={`${P}__rows`} aria-label="VPS tools">
          {[...views, ...tabs].map((x) => (
            <li key={x.key} className={`${P}__row`}>
              <span className={`${P}__name`}><Icon name={x.icon} size={14} /> <b>{x.label}</b> <span className="fx-small fx-muted">{x.from}</span></span>
              <Button size="sm" icon="external" onClick={x.go}>Open</Button>
            </li>
          ))}
          {!views.length && !tabs.length && <li className="fx-small fx-muted">Nothing else about the server is installed.</li>}
        </ul>
      </Container>
    </div>
  );
}
