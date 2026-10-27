/**
 * Overlay engine (asset type `overlay`, overlay@1): a floating pill drawn over other apps (Android:
 * a TYPE_APPLICATION_OVERLAY window owned by a foreground service; web: a corner pill inside the page).
 *
 *   pill      the always-there strip: status chips (each with an on/off label + tone, driven by runtime state)
 *             and one quick action (an action spec run on tap, e.g. `overlay.toggle`)
 *   log       the tappable log panel under the pill: lines with a confidence and a tag; tap a line to tune
 *             whatever produced it (e.g. a trigger threshold); kept to `maxLines`
 *   strip     the collapsed, untouchable strip shown while the overlay is hidden: the last `maxLines` lines,
 *             each alive for `lineMs`
 *   mini      the mini-screen host: any app fills it with its own content; `defaultOpen`, width / height ranges
 *   opacity, positionLock, size (hard limits for the pill + mini window, in dp and as a share of the screen)
 *
 * Pure rules shared by every port: normalising + validating the asset, clamping sizes and positions to the
 * screen, log trimming, strip line expiry, chip state, user settings (`axf.overlay.*`) over the asset. The
 * Kotlin twin is `ai.amberx.axf.kernel.engine.OverlayEngine`; fixture `spec/fixtures/overlay.json`, checked by
 * `spec/check-overlay.mts` and `OverlayConformanceTest`. Generalised from the detection overlay of Brett's
 * hands-free YouTube controller (OverlayView / MiniLogView / TunePopup / DetectionService): the pill, the
 * tap-to-tune log and the three-line strip come from there; everything app-specific (camera, triggers) stays out.
 */

import { CHIP_ID, CHIP_TONES, OVERLAY_LIMITS } from './overlay-rules.mjs';

export const OVERLAY_TYPE = 'overlay';

/** Settings keys (namespaced, same on every port). Values are strings as settings stores keep them. */
export const OVERLAY_SETTINGS = {
  /** `w,h` in dp — the user's resize of the mini window */
  size: 'axf.overlay.size',
  /** `x,y` in px — where the user dragged the pill */
  position: 'axf.overlay.position',
  /** 0.2–1 */
  opacity: 'axf.overlay.opacity',
  /** `true` / `false` */
  positionLock: 'axf.overlay.positionLock',
  /** `true` / `false` — the log panel */
  log: 'axf.overlay.log',
  /** `true` / `false` — the collapsed strip */
  strip: 'axf.overlay.strip',
  /** `true` / `false` — the mini screen open */
  mini: 'axf.overlay.mini',
} as const;

export { OVERLAY_LIMITS, CHIP_TONES, overlayErrors } from './overlay-rules.mjs';
/** Chip tone → theme colour token (same table the status widget uses). */
export const CHIP_TONE_TOKEN: Record<string, string> = { neutral: 'text', success: 'success', warning: 'warning', danger: 'danger', accent: 'accent', muted: 'muted', info: 'info' };

export interface OverlayChip {
  id: string;
  /** text while on (and the only text when `offLabel` is empty) */
  label: string;
  offLabel: string;
  tone: string;
  offTone: string;
  icon: string;
  /** starting state; the runtime drives it afterwards */
  on: boolean;
}
export interface OverlayRange { min: number; max: number; default: number }
export interface OverlayData {
  pill: { title: string; chips: OverlayChip[]; quickAction: string };
  log: { show: boolean; maxLines: number; showConfidence: boolean };
  strip: { show: boolean; maxLines: number; lineMs: number };
  mini: { defaultOpen: boolean; width: OverlayRange; height: OverlayRange };
  opacity: number;
  positionLock: boolean;
  size: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number; maxScreenWidthPct: number; maxScreenHeightPct: number };
}

export interface OverlayLogLine {
  /** text, trimmed to OVERLAY_LIMITS.lineTextMax */
  text: string;
  /** 0–1, or null when the line has none */
  confidence: number | null;
  tag: string;
  /** epoch ms */
  at: number;
  /** what produced the line (a trigger id, a job id …) — what tap-to-tune gets back */
  ref: string;
}

export interface ResolvedChip { id: string; text: string; tone: string; icon: string; on: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const text = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const numIn = (v: unknown, lo: number, hi: number, d: number) => { const n = num(v); return n === null ? d : round(clamp(n, lo, hi)); };

function range(raw: unknown, lo: number, hi: number, dMin: number, dMax: number, dDef: number): OverlayRange {
  const r = isObj(raw) ? raw : {};
  let min = numIn(r.min, lo, hi, dMin);
  let max = numIn(r.max, lo, hi, dMax);
  if (max < min) [min, max] = [max, min];
  const def = numIn(r.default, min, max, clamp(dDef, min, max));
  return { min, max, default: def };
}

export function normalizeChip(raw: unknown, index: number): OverlayChip | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' && CHIP_ID.test(raw.id) ? raw.id : '';
  if (!id) return null;
  const L = OVERLAY_LIMITS.labelMax;
  const label = text(raw.label, L, id);
  const tone = typeof raw.tone === 'string' && CHIP_TONES.includes(raw.tone) ? raw.tone : 'success';
  const offTone = typeof raw.offTone === 'string' && CHIP_TONES.includes(raw.offTone) ? raw.offTone : 'muted';
  void index;
  return { id, label, offLabel: text(raw.offLabel, L), tone, offTone, icon: text(raw.icon, 40), on: bool(raw.on, false) };
}

/** Tolerant: anything missing or odd becomes its default, every number is clamped, chips without an id are dropped. */
export function normalizeOverlay(raw: unknown): OverlayData {
  const d = isObj(raw) ? raw : {};
  const L = OVERLAY_LIMITS;
  const pill = isObj(d.pill) ? d.pill : {};
  const log = isObj(d.log) ? d.log : {};
  const strip = isObj(d.strip) ? d.strip : {};
  const mini = isObj(d.mini) ? d.mini : {};
  const size = isObj(d.size) ? d.size : {};
  const chips: OverlayChip[] = [];
  const seen = new Set<string>();
  if (Array.isArray(pill.chips)) for (const [i, c] of pill.chips.entries()) {
    const chip = normalizeChip(c, i);
    if (chip && !seen.has(chip.id) && chips.length < L.chipsMax) { seen.add(chip.id); chips.push(chip); }
  }
  let minWidth = numIn(size.minWidth, L.widthMin, L.widthMax, 120);
  let maxWidth = numIn(size.maxWidth, L.widthMin, L.widthMax, 480);
  if (maxWidth < minWidth) [minWidth, maxWidth] = [maxWidth, minWidth];
  let minHeight = numIn(size.minHeight, L.heightMin, L.heightMax, 48);
  let maxHeight = numIn(size.maxHeight, L.heightMin, L.heightMax, 640);
  if (maxHeight < minHeight) [minHeight, maxHeight] = [maxHeight, minHeight];
  return {
    pill: { title: text(pill.title, 40), chips, quickAction: text(pill.quickAction, 80) },
    log: { show: bool(log.show, true), maxLines: numIn(log.maxLines, L.logLinesMin, L.logLinesMax, L.logLinesDefault), showConfidence: bool(log.showConfidence, true) },
    strip: { show: bool(strip.show, true), maxLines: numIn(strip.maxLines, L.stripLinesMin, L.stripLinesMax, L.stripLinesDefault), lineMs: numIn(strip.lineMs, L.stripMsMin, L.stripMsMax, L.stripMsDefault) },
    mini: {
      defaultOpen: bool(mini.defaultOpen, false),
      width: range(mini.width, minWidth, maxWidth, minWidth, maxWidth, 220),
      height: range(mini.height, minHeight, maxHeight, minHeight, maxHeight, 260),
    },
    opacity: (() => { const n = num(d.opacity); return n === null ? L.opacityDefault : Math.round(clamp(n, L.opacityMin, L.opacityMax) * 100) / 100; })(),
    positionLock: bool(d.positionLock, false),
    size: { minWidth, maxWidth, minHeight, maxHeight, maxScreenWidthPct: numIn(size.maxScreenWidthPct, L.screenPctMin, L.screenPctMax, 90), maxScreenHeightPct: numIn(size.maxScreenHeightPct, L.screenPctMin, L.screenPctMax, 80) },
  };
}

/* ---------- geometry ---------- */

export interface Screen { width: number; height: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

/** The largest window the asset allows on this screen (dp). */
export function maxSize(d: OverlayData, screen: Screen): Size {
  return {
    width: Math.max(d.size.minWidth, Math.min(d.size.maxWidth, Math.floor(screen.width * d.size.maxScreenWidthPct / 100))),
    height: Math.max(d.size.minHeight, Math.min(d.size.maxHeight, Math.floor(screen.height * d.size.maxScreenHeightPct / 100))),
  };
}

/** A requested window size clamped into the asset's limits and the screen. Junk (0×0, NaN) becomes the mini defaults. */
export function clampSize(d: OverlayData, wanted: Partial<Size> | null | undefined, screen: Screen): Size {
  const mx = maxSize(d, screen);
  const w = num(wanted?.width); const h = num(wanted?.height);
  return {
    width: round(clamp(w === null || w <= 0 ? d.mini.width.default : w, Math.min(d.size.minWidth, mx.width), mx.width)),
    height: round(clamp(h === null || h <= 0 ? d.mini.height.default : h, Math.min(d.size.minHeight, mx.height), mx.height)),
  };
}

/** The mini screen's size: its own range, then the window limits. */
export function miniSize(d: OverlayData, wanted: Partial<Size> | null | undefined, screen: Screen): Size {
  const w = num(wanted?.width); const h = num(wanted?.height);
  return clampSize(d, {
    width: clamp(w === null || w <= 0 ? d.mini.width.default : w, d.mini.width.min, d.mini.width.max),
    height: clamp(h === null || h <= 0 ? d.mini.height.default : h, d.mini.height.min, d.mini.height.max),
  }, screen);
}

/** Keeps a window of `size` on the screen: a position dragged off the edge (or saved from a bigger screen) comes back. */
export function clampPosition(p: Partial<Point> | null | undefined, size: Size, screen: Screen): Point {
  const x = num(p?.x) ?? 0; const y = num(p?.y) ?? 0;
  return { x: round(clamp(x, 0, Math.max(0, screen.width - size.width))), y: round(clamp(y, 0, Math.max(0, screen.height - size.height))) };
}

/** May the user drag it? The setting wins over the asset. */
export function canDrag(d: OverlayData, settingLock: string | boolean | null | undefined): boolean {
  const lock = typeof settingLock === 'boolean' ? settingLock : settingLock === 'true' ? true : settingLock === 'false' ? false : d.positionLock;
  return !lock;
}

/* ---------- log ---------- */

export function logLine(text: string, confidence: number | null | undefined, tag: string | undefined, at: number, ref = ''): OverlayLogLine {
  const c = num(confidence);
  return { text: String(text ?? '').slice(0, OVERLAY_LIMITS.lineTextMax), confidence: c === null ? null : Math.round(clamp(c, 0, 1) * 10000) / 10000, tag: String(tag ?? '').slice(0, OVERLAY_LIMITS.tagMax), at: num(at) ?? 0, ref: String(ref ?? '').slice(0, 80) };
}

/** Adds a line and keeps the newest `maxLines` (oldest first). */
export function addLogLine(lines: readonly OverlayLogLine[], line: OverlayLogLine, maxLines: number): OverlayLogLine[] {
  return trimLog([...lines, line], maxLines);
}

export function trimLog(lines: readonly OverlayLogLine[], maxLines: number): OverlayLogLine[] {
  const n = round(clamp(num(maxLines) ?? OVERLAY_LIMITS.logLinesDefault, OVERLAY_LIMITS.logLinesMin, OVERLAY_LIMITS.logKeepMax));
  return lines.length <= n ? [...lines] : lines.slice(lines.length - n);
}

/** "85.0%" — one decimal, same on every port. */
export function confidenceText(confidence: number | null): string {
  return confidence === null ? '' : `${(Math.round(confidence * 1000) / 10).toFixed(1)}%`;
}

/** The text a log line shows: `text · 85.0% · tag` (parts left out when empty or when confidence is hidden). */
export function logLineText(line: OverlayLogLine, showConfidence: boolean): string {
  const parts = [line.text];
  if (showConfidence && line.confidence !== null) parts.push(confidenceText(line.confidence));
  if (line.tag) parts.push(line.tag);
  return parts.filter((p) => p !== '').join(' · ');
}

/** Opacity for the i-th oldest of n lines: the newest full, each older one a step dimmer, never under 0.35. */
export function logLineFade(index: number, count: number): number {
  const age = Math.max(0, count - 1 - index);
  return Math.max(0.35, Math.round((1 - age * 0.15) * 100) / 100);
}

/* ---------- collapsed strip ---------- */

/** The lines the strip shows at `now`: those added inside `lineMs`, newest `maxLines`, oldest first. */
export function stripLines(lines: readonly OverlayLogLine[], now: number, strip: { maxLines: number; lineMs: number }): OverlayLogLine[] {
  const alive = lines.filter((l) => now - l.at >= 0 && now - l.at < strip.lineMs);
  return alive.length <= strip.maxLines ? alive : alive.slice(alive.length - strip.maxLines);
}

/** Ms until the next strip line expires (≥ 16, so a timer never spins), or null when nothing is showing. */
export function nextStripExpiry(lines: readonly OverlayLogLine[], now: number, strip: { maxLines: number; lineMs: number }): number | null {
  const alive = stripLines(lines, now, strip);
  if (alive.length === 0) return null;
  return Math.max(16, Math.min(...alive.map((l) => l.at + strip.lineMs - now)));
}

/* ---------- chips ---------- */

/** Chips with their current state applied: `states` (id → on) over each chip's own starting state. */
export function resolveChips(chips: readonly OverlayChip[], states: Record<string, boolean | undefined>): ResolvedChip[] {
  return chips.map((c) => {
    const on = states[c.id] === undefined ? c.on : states[c.id] === true;
    return { id: c.id, text: on || !c.offLabel ? c.label : c.offLabel, tone: on ? c.tone : c.offTone, icon: c.icon, on };
  });
}

export function setChip(states: Record<string, boolean | undefined>, id: string, on: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(states)) if (v !== undefined) out[k] = v;
  out[id] = on;
  return out;
}

export function chipToneToken(tone: string): string { return CHIP_TONE_TOKEN[tone] ?? 'text'; }

/* ---------- settings over the asset ---------- */

/** The user's own choices (settings values as strings) over the asset's data. Unknown or junk values leave the asset's value. */
export function overlayWithSettings(d: OverlayData, values: Record<string, string | undefined>): OverlayData {
  const b = (k: string, cur: boolean) => { const v = values[k]; return v === 'true' ? true : v === 'false' ? false : cur; };
  const op = values[OVERLAY_SETTINGS.opacity];
  const opacity = op === undefined || op === '' || !Number.isFinite(Number(op)) ? d.opacity : Math.round(clamp(Number(op), OVERLAY_LIMITS.opacityMin, OVERLAY_LIMITS.opacityMax) * 100) / 100;
  const size = parseSize(values[OVERLAY_SETTINGS.size]);
  return {
    ...d,
    pill: { ...d.pill, chips: d.pill.chips.map((c) => ({ ...c })) },
    log: { ...d.log, show: b(OVERLAY_SETTINGS.log, d.log.show) },
    strip: { ...d.strip, show: b(OVERLAY_SETTINGS.strip, d.strip.show) },
    mini: {
      ...d.mini,
      defaultOpen: b(OVERLAY_SETTINGS.mini, d.mini.defaultOpen),
      width: { ...d.mini.width, default: size ? round(clamp(size.width, d.mini.width.min, d.mini.width.max)) : d.mini.width.default },
      height: { ...d.mini.height, default: size ? round(clamp(size.height, d.mini.height.min, d.mini.height.max)) : d.mini.height.default },
    },
    opacity,
    positionLock: b(OVERLAY_SETTINGS.positionLock, d.positionLock),
    size: { ...d.size },
  };
}

/** `w,h` → size, or null for anything else. */
export function parseSize(raw: string | null | undefined): Size | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (!m) return null;
  const w = Number(m[1]); const h = Number(m[2]);
  return w > 0 && h > 0 ? { width: w, height: h } : null;
}
export function serializeSize(s: Size): string { return `${round(s.width)},${round(s.height)}`; }

/** `x,y` → point, or null. */
export function parsePosition(raw: string | null | undefined): Point | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
export function serializePosition(p: Point): string { return `${round(p.x)},${round(p.y)}`; }
