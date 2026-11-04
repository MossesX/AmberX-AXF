/**
 * Alerts engine — developer alerts for any AXF app (alert@1).
 *
 * One alert per `key`: raising the same key again bumps its count and time instead of piling up copies, raises its
 * severity if the new one is worse, and reopens it if it had been resolved. Each raise reports what happened
 * (`new`, `repeat`, `escalated`, `reopened`); only `new`, `escalated` and `reopened` are worth pushing to a phone, so a
 * failing CI job that keeps failing pushes once, not every poll.
 *
 * Delivery rules say, per channel (bell, ntfy, webpush, or any channel an app adds), the lowest severity that goes
 * there, with per-source overrides (`off` silences a source on that channel). `diagnosticToAlert` turns the runtime's
 * diagnostics (asset / setting conflicts, crashes) into alerts the same way on every port.
 *
 * Pure and framework-agnostic: the Kotlin kernel mirrors it as AlertEngine (fixtures: spec/fixtures/alerts.json).
 * `AlertCenter` below is the small stateful wrapper apps use.
 */

export const ALERT_SEVERITIES = ['info', 'success', 'warning', 'error', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export type AlertEvent = 'new' | 'repeat' | 'escalated' | 'reopened';

/** What a source raises. `key` identifies the alert (same key = same alert); defaults to `source:title`. */
export interface AlertInput {
  source: string;
  severity: AlertSeverity;
  title: string;
  body?: string;
  key?: string;
  /** where to go to look at it or fix it (a URL, or `view:<id>` / `settings:<tab>` inside the app) */
  link?: string;
  /** free-form, small, non-secret details (run id, repo, plugin folder…) */
  meta?: Record<string, string | number | boolean>;
}

export interface Alert {
  /** = key (one alert per key) */
  id: string;
  key: string;
  source: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  link: string;
  meta: Record<string, string | number | boolean>;
  /** epoch ms */
  firstAt: number;
  lastAt: number;
  count: number;
  ack: boolean;
  resolved: boolean;
  resolvedAt: number | null;
}

export type ChannelMin = AlertSeverity | 'off';
export interface ChannelRule {
  /** lowest severity sent to this channel (`off` = nothing) */
  min: ChannelMin;
  /** per-source overrides */
  sources?: Record<string, ChannelMin>;
}
export interface AlertRules {
  channels: Record<string, ChannelRule>;
}

/** Built-in delivery rules: everything in the bell, errors and worse to the phone. */
export const DEFAULT_ALERT_RULES: AlertRules = {
  channels: {
    bell: { min: 'info' },
    ntfy: { min: 'error' },
    webpush: { min: 'error' },
  },
};

/** How many alerts are kept; the oldest resolved, then acknowledged, then any go first. */
export const ALERT_LIMIT = 500;

const TITLE_MAX = 200;
const BODY_MAX = 2000;
const KEY_MAX = 200;

export const severityRank = (s: string): number => {
  const i = (ALERT_SEVERITIES as readonly string[]).indexOf(s);
  return i < 0 ? 0 : i;
};
export const isSeverity = (s: unknown): s is AlertSeverity => typeof s === 'string' && (ALERT_SEVERITIES as readonly string[]).includes(s);

/** The alert's identity: the given key, else `source:title` (trimmed, at most 200 characters). */
export function alertKey(input: Pick<AlertInput, 'source' | 'title' | 'key'>): string {
  const k = (input.key && input.key.trim()) || `${input.source.trim()}:${input.title.trim()}`;
  return k.slice(0, KEY_MAX);
}

const clip = (s: string | undefined, n: number) => (s ?? '').slice(0, n);
/** Plain code-point order (same on every port; localeCompare differs between platforms). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Add or update an alert. Returns the new list (the input list is not changed), the alert and what happened.
 * `now` is epoch ms; pass it in so every port gives the same result for the same inputs.
 */
export function applyAlert(list: readonly Alert[], input: AlertInput, now: number): { list: Alert[]; alert: Alert; event: AlertEvent } {
  const key = alertKey(input);
  const severity: AlertSeverity = isSeverity(input.severity) ? input.severity : 'info';
  const i = list.findIndex((a) => a.key === key);
  let alert: Alert;
  let event: AlertEvent;
  if (i < 0) {
    alert = {
      id: key, key, source: input.source, severity, title: clip(input.title, TITLE_MAX), body: clip(input.body, BODY_MAX),
      link: input.link ?? '', meta: { ...(input.meta ?? {}) }, firstAt: now, lastAt: now, count: 1, ack: false, resolved: false, resolvedAt: null,
    };
    event = 'new';
  } else {
    const old = list[i]!;
    const worse = severityRank(severity) > severityRank(old.severity);
    event = old.resolved ? 'reopened' : worse ? 'escalated' : 'repeat';
    alert = {
      ...old,
      severity: old.resolved ? severity : worse ? severity : old.severity,
      title: clip(input.title, TITLE_MAX) || old.title,
      body: input.body !== undefined ? clip(input.body, BODY_MAX) : old.body,
      link: input.link ?? old.link,
      meta: { ...old.meta, ...(input.meta ?? {}) },
      firstAt: old.resolved ? now : old.firstAt,
      lastAt: now,
      count: old.resolved ? 1 : old.count + 1,
      // a repeat keeps your acknowledgement; anything worse or back again asks for attention
      ack: event === 'repeat' ? old.ack : false,
      resolved: false,
      resolvedAt: null,
    };
  }
  const next = i < 0 ? [...list, alert] : list.map((a, j) => (j === i ? alert : a));
  return { list: trimAlerts(next), alert, event };
}

/** Mark alerts resolved (the thing is fixed). Unknown keys are ignored. */
export function resolveAlerts(list: readonly Alert[], keys: readonly string[], now: number): Alert[] {
  const set = new Set(keys);
  return list.map((a) => (set.has(a.key) && !a.resolved ? { ...a, resolved: true, resolvedAt: now, ack: true } : a));
}

/** Acknowledge alerts (seen); `'all'` acknowledges every one. */
export function ackAlerts(list: readonly Alert[], ids: readonly string[] | 'all'): Alert[] {
  const set = ids === 'all' ? null : new Set(ids);
  return list.map((a) => (!a.ack && (!set || set.has(a.id)) ? { ...a, ack: true } : a));
}

/** Remove alerts for good (from the list, not just resolved). */
export function dismissAlerts(list: readonly Alert[], ids: readonly string[]): Alert[] {
  const set = new Set(ids);
  return list.filter((a) => !set.has(a.id));
}

/** Not acknowledged and not resolved. */
export const unreadCount = (list: readonly Alert[]): number => list.filter((a) => !a.ack && !a.resolved).length;

/** Newest first; unresolved before resolved. */
export function sortAlerts(list: readonly Alert[]): Alert[] {
  return [...list].sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.lastAt - a.lastAt || cmp(a.key, b.key));
}

/** Keep at most `limit`: drop the oldest resolved first, then acknowledged, then the oldest of the rest. */
export function trimAlerts(list: readonly Alert[], limit = ALERT_LIMIT): Alert[] {
  if (list.length <= limit) return [...list];
  const tier = (a: Alert) => (a.resolved ? 0 : a.ack ? 1 : 2);
  const drop = new Set(
    [...list].sort((a, b) => tier(a) - tier(b) || a.lastAt - b.lastAt || cmp(a.key, b.key)).slice(0, list.length - limit).map((a) => a.key),
  );
  return list.filter((a) => !drop.has(a.key));
}

/** The lowest severity a channel takes for a source (`off` = none). */
export function channelMin(rules: AlertRules, channel: string, source: string): ChannelMin {
  const r = rules.channels[channel];
  if (!r) return 'off';
  return r.sources?.[source] ?? r.min;
}

/**
 * Channels an alert goes to for this event. Repeats only reach the bell (it shows the new count); phones hear about
 * new, escalated and reopened alerts only.
 */
export function deliveryTargets(alert: Pick<Alert, 'severity' | 'source'>, event: AlertEvent, rules: AlertRules = DEFAULT_ALERT_RULES): string[] {
  const out: string[] = [];
  for (const channel of Object.keys(rules.channels).sort()) {
    const min = channelMin(rules, channel, alert.source);
    if (min === 'off' || severityRank(alert.severity) < severityRank(min)) continue;
    if (event === 'repeat' && channel !== 'bell') continue;
    out.push(channel);
  }
  return out;
}

/** ntfy priority (1 min … 5 max) for a severity. */
export function ntfyPriority(severity: AlertSeverity): number {
  return ({ info: 2, success: 2, warning: 3, error: 4, critical: 5 } as const)[severity] ?? 3;
}

/* ---------------- diagnostics → alerts ---------------- */

/** What the runtime reports about itself (see AxfRuntime.diagnostics). */
export type Diagnostic =
  | { kind: 'asset-conflict'; type: string; id: string; was: string; now: string }
  | { kind: 'setting-conflict'; key: string; was: string; now: string }
  | { kind: 'contribution-conflict'; what: string; id: string; was: string; now: string }
  | { kind: 'crash'; where: string; message: string; detail?: string };

/** The alert a diagnostic becomes. Conflicts are warnings (one alert per clash); crashes are errors. */
export function diagnosticToAlert(d: Diagnostic): AlertInput {
  switch (d.kind) {
    case 'asset-conflict':
      return { source: 'conflicts', severity: 'warning', key: `conflict:asset:${d.type}/${d.id}`, title: `Two ${d.type} assets share the id "${d.id}"`, body: `The ${d.now} copy replaced the ${d.was} one. Give one of them another id.`, meta: { type: d.type, id: d.id, was: d.was, now: d.now } };
    case 'setting-conflict':
      return { source: 'conflicts', severity: 'warning', key: `conflict:setting:${d.key}`, title: `Two modules use the setting "${d.key}"`, body: `${d.was} and ${d.now} read and write the same value. Prefix setting keys with the module id.`, meta: { key: d.key, was: d.was, now: d.now } };
    case 'contribution-conflict':
      return { source: 'conflicts', severity: 'warning', key: `conflict:${d.what}:${d.id}`, title: `Two modules add the ${d.what} "${d.id}"`, body: `${d.now} replaced the one from ${d.was}.`, meta: { what: d.what, id: d.id, was: d.was, now: d.now } };
    case 'crash':
      return { source: 'crashes', severity: 'error', key: `crash:${d.where}:${d.message.slice(0, 120)}`, title: `Crash in ${d.where}`, body: d.detail ? `${d.message}\n${d.detail}` : d.message, meta: { where: d.where } };
  }
}

/* ---------------- stateful wrapper ---------------- */

export interface AlertChange {
  alert: Alert;
  event: AlertEvent;
  targets: string[];
}

/** Holds a list, applies the engine, tells listeners. Apps (and the alerts library) wrap one of these. */
export class AlertCenter {
  private items: Alert[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly changes = new Set<(c: AlertChange) => void>();
  rules: AlertRules;

  constructor(opts: { rules?: AlertRules; alerts?: Alert[]; now?: () => number } = {}) {
    this.rules = opts.rules ?? DEFAULT_ALERT_RULES;
    this.items = trimAlerts(opts.alerts ?? []);
    if (opts.now) this.now = opts.now;
  }

  now: () => number = () => Date.now();

  get list(): Alert[] { return sortAlerts(this.items); }
  get unread(): number { return unreadCount(this.items); }

  /** Raise (or bump) an alert; returns what happened and where it should be delivered. */
  raise(input: AlertInput): AlertChange {
    const r = applyAlert(this.items, input, this.now());
    this.items = r.list;
    const change = { alert: r.alert, event: r.event, targets: deliveryTargets(r.alert, r.event, this.rules) };
    for (const fn of this.changes) fn(change);
    this.emit();
    return change;
  }

  resolve(keys: string[]): void { this.items = resolveAlerts(this.items, keys, this.now()); this.emit(); }
  ack(ids: string[] | 'all'): void { this.items = ackAlerts(this.items, ids); this.emit(); }
  dismiss(ids: string[]): void { this.items = dismissAlerts(this.items, ids); this.emit(); }
  /** Replace the whole list (e.g. what a server sent). */
  replace(alerts: Alert[]): void { this.items = trimAlerts(alerts); this.emit(); }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** Called for every raise, with its event and delivery targets. */
  onChange(fn: (c: AlertChange) => void): () => void { this.changes.add(fn); return () => { this.changes.delete(fn); }; }

  private emit(): void { for (const fn of this.listeners) fn(); }
}
