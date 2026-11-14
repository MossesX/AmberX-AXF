/**
 * Date and time pickers (themed-controls@1 family `datetime`): the field (typed value + a picker button) and the picker
 * on the family's surface (popover on a wide screen, bottom sheet on a phone). s12: the calendar for date, month and
 * week inputs (month grid, today, min / max, keyboard grid navigation, screen-reader labels). s13: hour / minute
 * columns for time and datetime-local, 12 / 24 h from the locale or the token.
 */
import type { TcProps } from '@console/axf/core/engines/themed-controls';
import type { ElementFamily, Swap, SwapCtx } from '../host';
import { aria, h } from './dom';
import { iconButton, openSurface, type OpenSurface } from './surface';

/* ---------------- dates (local, no time zone maths: the value is a wall-clock date) ---------------- */

export interface Ymd { y: number; m: number; d: number }
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const isoDate = (v: Ymd) => `${pad(v.y, 4)}-${pad(v.m)}-${pad(v.d)}`;
export function parseDate(s: string | null | undefined): Ymd | null {
  const m = /^(\d{4,})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  if (!m) return null;
  const v = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const dt = new Date(v.y, v.m - 1, v.d);
  return dt.getFullYear() === v.y && dt.getMonth() === v.m - 1 && dt.getDate() === v.d ? v : null;
}
const toDate = (v: Ymd) => new Date(v.y, v.m - 1, v.d);
const fromDate = (d: Date): Ymd => ({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
export const addDays = (v: Ymd, n: number) => fromDate(new Date(v.y, v.m - 1, v.d + n));
export function addMonths(v: Ymd, n: number): Ymd {
  const first = new Date(v.y, v.m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return { y: first.getFullYear(), m: first.getMonth() + 1, d: Math.min(v.d, last) };
}
export const todayYmd = () => fromDate(new Date());
/** ISO week of a date: `YYYY-Www`. */
export function isoWeek(v: Ymd): string {
  const d = new Date(Date.UTC(v.y, v.m - 1, v.d));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${pad(Math.ceil(((d.getTime() - y0.getTime()) / 86400000 + 1) / 7))}`;
}
/** Monday of an ISO week string. */
export function weekStart(s: string): Ymd | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(s);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (Number(m[2]) - 1) * 7);
  return { y: mon.getUTCFullYear(), m: mon.getUTCMonth() + 1, d: mon.getUTCDate() };
}

/** First day of the week: the token (`data-fx-tc-datetime-week-start`) or the locale. 0 = Sunday, 1 = Monday. */
export function firstDay(): 0 | 1 {
  const t = document.documentElement.getAttribute('data-fx-tc-datetime-week-start');
  if (t === 'sunday') return 0;
  if (t === 'monday') return 1;
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const fd = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    if (fd) return fd === 7 ? 0 : 1;
  } catch { /* older engines */ }
  return /^(en-(US|CA)|ja|ko|zh-TW|he|pt-BR)/.test(navigator.language) ? 0 : 1;
}

/** 12-hour clock? data-axf-hour12 on the element, else the token (`data-fx-tc-datetime-hour-cycle`), else the locale. */
export function hour12(p: TcProps): boolean {
  if (typeof p.hour12 === 'boolean') return p.hour12;
  const t = document.documentElement.getAttribute('data-fx-tc-datetime-hour-cycle');
  if (t === '12') return true;
  if (t === '24') return false;
  return Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;
}

/* ---------------- the calendar ---------------- */

export interface CalendarOpts {
  mode: 'day' | 'month';
  value: Ymd | null;
  min: Ymd | null;
  max: Ymd | null;
  /** show which ISO week a day is in (week inputs pick a week) */
  week?: boolean;
  onPick(v: Ymd): void;
}

export interface Calendar {
  el: HTMLElement;
  focus(): void;
  view(): { year: number; month: number; focused: string };
  move(to: Ymd): void;
}

const cmp = (a: Ymd, b: Ymd) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
const cmpMonth = (a: Ymd, b: Ymd) => (a.y - b.y) || (a.m - b.m);

export function calendar(o: CalendarOpts): Calendar {
  const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtWd = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const fmtWdLong = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
  const fmtMon = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const fmtMonLong = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const today = todayYmd();
  let focused: Ymd = o.value ?? (o.min && cmp(today, o.min) < 0 ? o.min : o.max && cmp(today, o.max) > 0 ? o.max : today);
  const fd = firstDay();

  const title = h('span', { class: 'fx-tc-cal__title', 'aria-live': 'polite' });
  const prev = iconButton(o.mode === 'day' ? 'Previous month' : 'Previous year', 'chevron-left', 'fx-tc-cal__nav');
  const next = iconButton(o.mode === 'day' ? 'Next month' : 'Next year', 'chevron-right', 'fx-tc-cal__nav');
  const grid = h('div', { class: `fx-tc-cal__grid fx-tc-cal__grid--${o.mode}`, role: 'grid' });
  const el = h('div', { class: 'fx-tc-cal' }, h('div', { class: 'fx-tc-cal__head' }, prev, title, next), grid);
  grid.setAttribute('aria-labelledby', (title.id = `tc-cal-${Math.random().toString(36).slice(2, 8)}`));

  const disabled = (v: Ymd) => o.mode === 'day'
    ? (!!o.min && cmp(v, o.min) < 0) || (!!o.max && cmp(v, o.max) > 0)
    : (!!o.min && cmpMonth(v, o.min) < 0) || (!!o.max && cmpMonth(v, o.max) > 0);

  const cell = (v: Ymd, text: string, label: string, outside: boolean) => {
    const same = o.mode === 'day' ? (a: Ymd | null) => !!a && cmp(a, v) === 0 : (a: Ymd | null) => !!a && cmpMonth(a, v) === 0;
    const c = h('span', { class: 'fx-tc-cal__cell', role: 'gridcell', tabindex: same(focused) ? '0' : '-1', 'data-date': isoDate(v), 'aria-label': label });
    c.textContent = text;
    if (outside) c.classList.add('fx-tc-cal__cell--outside');
    if (same(o.value)) c.setAttribute('aria-selected', 'true');
    if (same(today)) c.setAttribute('aria-current', 'date');
    if (disabled(v)) c.setAttribute('aria-disabled', 'true');
    return c;
  };

  const render = () => {
    grid.replaceChildren();
    if (o.mode === 'day') {
      title.textContent = fmtMonth.format(new Date(focused.y, focused.m - 1, 1));
      const head = h('div', { class: 'fx-tc-cal__row', role: 'row' });
      for (let i = 0; i < 7; i++) {
        const day = new Date(2024, 0, 7 + fd + i); // 2024-01-07 is a Sunday
        const th = h('span', { class: 'fx-tc-cal__wd', role: 'columnheader', 'aria-label': fmtWdLong.format(day) });
        th.textContent = fmtWd.format(day);
        head.append(th);
      }
      grid.append(head);
      const first = { y: focused.y, m: focused.m, d: 1 };
      const lead = (toDate(first).getDay() - fd + 7) % 7;
      let at = addDays(first, -lead);
      for (let r = 0; r < 6; r++) {
        const row = h('div', { class: 'fx-tc-cal__row', role: 'row' });
        for (let c = 0; c < 7; c++) {
          row.append(cell(at, String(at.d), `${fmtDay.format(toDate(at))}${o.week ? `, week ${isoWeek(at).slice(-2)}` : ''}`, at.m !== focused.m));
          at = addDays(at, 1);
        }
        grid.append(row);
      }
    } else {
      title.textContent = String(focused.y);
      for (let r = 0; r < 4; r++) {
        const row = h('div', { class: 'fx-tc-cal__row', role: 'row' });
        for (let c = 0; c < 3; c++) {
          const v = { y: focused.y, m: r * 3 + c + 1, d: 1 };
          row.append(cell(v, fmtMon.format(toDate(v)), fmtMonLong.format(toDate(v)), false));
        }
        grid.append(row);
      }
    }
  };

  const focusCell = () => grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  const move = (to: Ymd) => { focused = to; render(); focusCell(); };
  const pick = (v: Ymd) => { if (!disabled(v)) o.onPick(v); };

  prev.addEventListener('click', () => { focused = o.mode === 'day' ? addMonths(focused, -1) : { ...focused, y: focused.y - 1 }; render(); });
  next.addEventListener('click', () => { focused = o.mode === 'day' ? addMonths(focused, 1) : { ...focused, y: focused.y + 1 }; render(); });
  grid.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.fx-tc-cal__cell');
    const v = c ? parseDate(c.dataset.date) : null;
    if (v) { focused = v; pick(v); }
  });
  grid.addEventListener('keydown', (e) => {
    const day = o.mode === 'day';
    const dow = (toDate(focused).getDay() - fd + 7) % 7;
    const keys: Record<string, () => Ymd> = day ? {
      ArrowLeft: () => addDays(focused, document.dir === 'rtl' ? 1 : -1), ArrowRight: () => addDays(focused, document.dir === 'rtl' ? -1 : 1),
      ArrowUp: () => addDays(focused, -7), ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -dow), End: () => addDays(focused, 6 - dow),
      PageUp: () => (e.shiftKey ? addMonths(focused, -12) : addMonths(focused, -1)), PageDown: () => (e.shiftKey ? addMonths(focused, 12) : addMonths(focused, 1)),
    } : {
      ArrowLeft: () => addMonths(focused, -1), ArrowRight: () => addMonths(focused, 1), ArrowUp: () => addMonths(focused, -3), ArrowDown: () => addMonths(focused, 3),
      Home: () => ({ ...focused, m: 1 }), End: () => ({ ...focused, m: 12 }), PageUp: () => addMonths(focused, -12), PageDown: () => addMonths(focused, 12),
    };
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(focused); return; }
    const f = keys[e.key];
    if (!f) return;
    e.preventDefault();
    move(f());
  });
  render();
  return { el, focus: focusCell, view: () => ({ year: focused.y, month: focused.m, focused: isoDate(focused) }), move };
}

/* ---------------- the field + picker ---------------- */

type Kind = 'date' | 'time' | 'datetime-local' | 'month' | 'week';
const PLACEHOLDER: Record<Kind, string> = { date: 'yyyy-mm-dd', time: 'hh:mm', 'datetime-local': 'yyyy-mm-dd hh:mm', month: 'yyyy-mm', week: 'yyyy-Www' };
const PICK_LABEL: Record<Kind, string> = { date: 'Choose date', time: 'Choose time', 'datetime-local': 'Choose date and time', month: 'Choose month', week: 'Choose week' };

/** Typed text → the input's value format, or null when it isn't one. */
export function normalizeTyped(kind: Kind, text: string): string | null {
  const t = text.trim();
  if (t === '') return '';
  if (kind === 'date') { const v = parseDate(t); return v ? isoDate(v) : null; }
  if (kind === 'month') { const m = /^(\d{4})-(\d{1,2})$/.exec(t); return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${pad(Number(m[2]))}` : null; }
  if (kind === 'week') { const m = /^(\d{4})-?W(\d{1,2})$/i.exec(t); return m && Number(m[2]) >= 1 && Number(m[2]) <= 53 ? `${m[1]}-W${pad(Number(m[2]))}` : null; }
  const time = (s: string) => {
    const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
    if (!m) return null;
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    if (m[4]) { if (hh < 1 || hh > 12) return null; hh = (hh % 12) + (/pm/i.test(m[4]) ? 12 : 0); }
    if (hh > 23 || mm > 59) return null;
    return `${pad(hh)}:${pad(mm)}${m[3] ? `:${m[3]}` : ''}`;
  };
  if (kind === 'time') return time(t);
  const m = /^(\d{4}-\d{2}-\d{2})[T ](.+)$/.exec(t);
  if (!m) return null;
  const d = parseDate(m[1]);
  const tm = time(m[2]!);
  return d && tm ? `${isoDate(d)}T${tm}` : null;
}

/** The value as shown in the field (ISO date, 24 h or 12 h time). */
export function shown(kind: Kind, value: string, h12: boolean): string {
  if (!value) return '';
  const t = (s: string) => {
    const m = /^(\d{2}):(\d{2})/.exec(s);
    if (!m || !h12) return s.slice(0, 5);
    const hh = Number(m[1]);
    return `${((hh + 11) % 12) + 1}:${m[2]} ${hh < 12 ? 'AM' : 'PM'}`;
  };
  if (kind === 'time') return t(value);
  if (kind === 'datetime-local') { const [d, tm = ''] = value.split('T'); return `${d} ${t(tm)}`; }
  return value;
}

/** Time columns, filled in by s13 (time.ts); the date part works without them. */
export interface TimeColumns { el: HTMLElement; value(): string; focus(): void }
export type TimeFactory = (o: { value: string; hour12: boolean; minuteStep: number; onPick?: () => void }) => TimeColumns;
let timeFactory: TimeFactory | null = null;
export function setTimeFactory(f: TimeFactory): void { timeFactory = f; }

export const datetimeFamily: ElementFamily = {
  family: 'datetime',
  selector: 'input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"], input[type="week"]',
  mount(ctx: SwapCtx): Swap {
    let p = ctx.props();
    const kind = () => String(p.kind) as Kind;
    const field = h('input', { type: 'text', class: 'fx-input fx-tc-date__field', autocomplete: 'off', spellcheck: 'false' });
    const btn = iconButton(PICK_LABEL[kind()], kind() === 'time' ? 'clock' : 'calendar', 'fx-tc-date__btn');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    const el = h('span', { class: 'fx-tc-date' }, field, btn);
    let surface: OpenSurface | null = null;
    let cal: Calendar | null = null;

    const commit = (v: string) => { ctx.setValue(v, true); };
    const close = (why: 'done' | 'api' = 'done') => surface?.close(why);

    const open = () => {
      if (surface || ctx.input.disabled || ctx.input.readOnly) return;
      const k = kind();
      const content = h('div', { class: 'fx-tc-picker' });
      const value = ctx.input.value;
      const datePart = k === 'week' ? weekStart(value) : parseDate(k === 'month' ? `${value}-01` : value);
      const minS = String(p.min ?? ''), maxS = String(p.max ?? '');
      const lim = (s: string) => (k === 'week' ? weekStart(s) : parseDate(k === 'month' ? `${s}-01` : s));
      let time: TimeColumns | null = null;
      const timeVal = k === 'time' ? value : k === 'datetime-local' ? value.split('T')[1] ?? '' : '';
      const finish = (d: Ymd | null) => {
        if (k === 'date') commit(d ? isoDate(d) : '');
        else if (k === 'month') commit(d ? isoDate(d).slice(0, 7) : '');
        else if (k === 'week') commit(d ? isoWeek(d) : '');
        else if (k === 'time') commit(time?.value() ?? timeVal);
        else commit(d ? `${isoDate(d)}T${time?.value() || timeVal || '00:00'}` : '');
        close();
      };
      let picked: Ymd | null = datePart;
      if (k !== 'time') {
        cal = calendar({
          mode: k === 'month' ? 'month' : 'day', value: datePart, min: lim(minS), max: lim(maxS), week: k === 'week',
          onPick: (v) => { picked = v; if (k === 'datetime-local' && time) { cal?.move(v); markPicked(v); } else finish(v); },
        });
        content.append(cal.el);
      }
      const markPicked = (v: Ymd) => content.querySelectorAll('.fx-tc-cal__cell').forEach((c) => c.toggleAttribute('aria-selected', (c as HTMLElement).dataset.date === isoDate(v)));
      if ((k === 'time' || k === 'datetime-local') && timeFactory) {
        const step = Number(p.step) || Number(getComputedStyle(document.documentElement).getPropertyValue('--fx-tc-datetime-minute-step')) || 5;
        time = timeFactory({ value: timeVal, hour12: hour12(p), minuteStep: step });
        content.append(time.el);
      }
      const foot = h('div', { class: 'fx-tc-picker__foot' });
      if (k !== 'time') {
        const today = h('button', { type: 'button', class: 'fx-btn fx-btn--ghost' });
        today.textContent = k === 'month' ? 'This month' : k === 'week' ? 'This week' : 'Today';
        today.addEventListener('click', () => { const t = todayYmd(); if (k === 'datetime-local') { picked = t; cal?.move(t); markPicked(t); } else finish(t); });
        foot.append(today);
      }
      if (!p.required) {
        const clear = h('button', { type: 'button', class: 'fx-btn fx-btn--ghost' });
        clear.textContent = 'Clear';
        clear.addEventListener('click', () => { commit(''); close(); });
        foot.append(clear);
      }
      if (k === 'time' || k === 'datetime-local') {
        const done = h('button', { type: 'button', class: 'fx-btn fx-btn--primary' });
        done.textContent = 'Done';
        done.addEventListener('click', () => finish(picked ?? todayYmd()));
        foot.append(done);
      }
      content.append(foot);
      btn.setAttribute('aria-expanded', 'true');
      surface = openSurface({
        surface: ctx.surface(), anchor: el, label: PICK_LABEL[k], content, family: 'datetime',
        initialFocus: () => (cal ? (cal.el.querySelector<HTMLElement>('[tabindex="0"]')) : time?.el.querySelector<HTMLElement>('[tabindex="0"]') ?? null),
        onClose: () => { surface = null; cal = null; btn.setAttribute('aria-expanded', 'false'); },
      });
    };

    btn.addEventListener('click', () => (surface ? close('api') : open()));
    field.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowDown' && e.altKey) || e.key === 'F4') { e.preventDefault(); open(); }
      if (e.key === 'Enter') { const v = normalizeTyped(kind(), field.value); if (v !== null) commit(v); }
    });
    field.addEventListener('change', () => {
      const v = normalizeTyped(kind(), field.value);
      if (v === null) { field.setAttribute('aria-invalid', 'true'); return; }
      commit(v);
    });

    return {
      el,
      focusEl: () => field,
      sync(next) {
        p = next;
        const k = kind();
        if (document.activeElement !== field || normalizeTyped(k, field.value) !== String(p.value)) field.value = shown(k, String(p.value ?? ''), hour12(p));
        field.placeholder = PLACEHOLDER[k];
        field.disabled = !!p.disabled;
        field.readOnly = !!p.readOnly;
        btn.disabled = !!p.disabled || !!p.readOnly;
        btn.setAttribute('aria-label', PICK_LABEL[k]);
        aria(field, {
          'aria-label': (p.label && !String(p.label).startsWith('#') ? String(p.label) : ctx.labelText()) || PICK_LABEL[k],
          'aria-labelledby': String(p.label).startsWith('#') ? String(p.label).slice(1) : null,
          'aria-describedby': p.describedBy ? String(p.describedBy) : null,
          'aria-required': p.required ? 'true' : null,
          'aria-invalid': p.invalid ? 'true' : null,
        });
        el.toggleAttribute('data-disabled', !!p.disabled);
        el.toggleAttribute('data-invalid', !!p.invalid);
        el.dataset.kind = k;
      },
      destroy() { close('api'); },
      state: () => ({ kind: kind(), value: ctx.input.value, open: !!surface, surface: surface?.surface ?? null, ...(cal ? { view: cal.view() } : {}), min: p.min || null, max: p.max || null }),
      set(v) {
        const s = normalizeTyped(kind(), String(v ?? ''));
        if (s === null) throw new Error(`"${String(v)}" is not a ${kind()} value (${PLACEHOLDER[kind()]})`);
        commit(s);
      },
      open,
      close: () => close('api'),
    };
  },
};
