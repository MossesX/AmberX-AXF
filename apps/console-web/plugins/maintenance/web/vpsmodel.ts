/**
 * The VPS plugin's pure parts (no React): gauge types, the heat colour of a level, value text, banner badge ids.
 * The heat colour mixes two theme colour tokens (the stops are tokens, so the theme recolours them); the server works out
 * which two stops a level sits between (GET /gauges → metric.heat).
 */

export interface Heat { from: string; to: string; t: number }
export interface Metric { id: string; label: string; pct: number | null; used: number | null; total: number | null; unit: 'cpus' | 'bytes'; heat: Heat; level: 'ok' | 'warn' | 'high' }
export interface Disk { mount: string; device: string; fs: string; total: number; used: number; free: number; pct: number }
export interface ContainerStat { name: string; cpu: number | null; memPct: number | null; mem: number; memLimit: number }
export interface Proc { pid: number; cpu: number; memPct: number; rss: number; name: string }
export type HistoryPoint = { t: number } & Record<string, number | null>;
export interface HeatStop { at: number; token: string }
export interface VpsSettings {
  view: 'radial' | 'bars' | 'strip' | 'history';
  warnPct: number; highPct: number;
  bannerShow: boolean; bannerMode: 'icon' | 'value' | 'meters'; bannerMetrics: string[]; bannerSide: 'left' | 'right';
  refreshS: number; heat: HeatStop[];
}
export interface Gauges {
  at: string; source: 'host' | 'console'; cpus: number;
  load: Record<string, number>; metrics: Metric[]; disks: Disk[]; containers: ContainerStat[]; top: Proc[]; history: HistoryPoint[];
  settings: VpsSettings;
}

export const VIEWS: { value: VpsSettings['view']; label: string; icon: string }[] = [
  { value: 'radial', label: 'Radial', icon: 'monitor' }, { value: 'bars', label: 'Bars', icon: 'chart' },
  { value: 'strip', label: 'Strip', icon: 'list' }, { value: 'history', label: 'History', icon: 'clock' },
];
export const MODES = [{ value: 'icon', label: 'Icon only (heat colour)' }, { value: 'value', label: 'Icon and value' }, { value: 'meters', label: 'Mini meters' }];
export const HEAT_TOKENS = ['text', 'muted', 'border', 'surface', 'bg', 'accent', 'info', 'success', 'warning', 'danger'];
export const TOKEN_LABEL: Record<string, string> = { text: 'Text (white on dark)', muted: 'Muted (gray)', border: 'Border', surface: 'Surface', bg: 'Background (black on dark)', accent: 'Accent', info: 'Info', success: 'Success', warning: 'Warning', danger: 'Danger (red)' };
export const ICON: Record<string, string> = { load: 'zap', ram: 'grid', swap: 'layers', disk: 'save' };
export const iconOf = (id: string) => ICON[id] ?? (id.startsWith('disk') ? 'save' : 'monitor');

/** A CSS colour for a heat position: two theme tokens mixed, never a literal colour. */
export function heatCss(h: Heat | null | undefined): string {
  if (!h) return 'var(--fx-muted)';
  const p = Math.round(Math.max(0, Math.min(1, h.t)) * 100);
  if (h.from === h.to || p === 0) return `var(--fx-${h.from})`;
  return `color-mix(in oklab, var(--fx-${h.to}) ${p}%, var(--fx-${h.from}))`;
}

/** The same mix on the web side (previews of edited stops before they are saved). */
export function heatAt(pct: number | null, stops: HeatStop[]): Heat {
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!; const b = stops[i + 1]!;
    if (p <= b.at) return { from: a.token, to: b.token, t: (p - a.at) / Math.max(1, b.at - a.at) };
  }
  const last = stops[stops.length - 1] ?? { at: 0, token: 'muted' };
  return { from: last.token, to: last.token, t: 0 };
}

const gb = (n: number | null) => (n === null ? '?' : (n / 1024 ** 3) < 10 ? (n / 1024 ** 3).toFixed(1) : String(Math.round(n / 1024 ** 3)));
/** "9.4 / 16 GB", "3.6 / 8 CPUs", "no swap". */
export function valueText(m: Metric): string {
  if (m.unit === 'cpus') return `${m.used ?? '?'} / ${m.total ?? '?'} CPUs`;
  if (m.id === 'swap' && !m.total) return 'no swap';
  return `${gb(m.used)} / ${gb(m.total)} GB`;
}
export const pctText = (m: Pick<Metric, 'pct'>) => (m.pct === null ? '?' : `${Math.round(m.pct)}%`);
/** What a gauge is, in a few words (the dropdown's last column). */
export function aboutOf(m: Metric, load?: Record<string, number>): string {
  if (m.id === 'load') return `load ${load?.['1'] ?? '?'} · ${load?.['5'] ?? '?'} · ${load?.['15'] ?? '?'} (1/5/15 min)`;
  if (m.id === 'ram') return 'memory in use';
  if (m.id === 'swap') return 'swap in use';
  return `space used on ${m.label.replace(/^Disk /, '')}`;
}
/** A text meter for the banner's mini-meter mode: five cells. */
export function miniMeter(pct: number | null): string {
  const lit = Math.round(Math.max(0, Math.min(100, pct ?? 0)) / 20);
  return '▰'.repeat(lit) + '▱'.repeat(5 - lit);
}
export const badgeId = (metric: string) => `vps-${metric.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '').toLowerCase()}`;
export const shortName = (m: Metric) => (m.id === 'disk' ? 'Disk' : m.id.startsWith('disk:') ? m.label.replace(/^Disk /, '') : m.label);
