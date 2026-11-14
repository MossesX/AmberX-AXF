/**
 * Hour / minute columns for time and datetime-local pickers (s13), plugged into the date picker through
 * setTimeFactory. Each column is a listbox (role="listbox", options role="option", aria-selected): Up / Down pick in
 * a column, Home / End jump, Left / Right move between columns, Enter confirms (the picker's Done). 12 / 24 h comes
 * from the element (data-axf-hour12), the token (datetime.hourCycle) or the locale; minutes step by the input's
 * step or the token (datetime.minuteStep), and a value off the step is still shown.
 */
import { h } from './dom';
import { setTimeFactory, type TimeColumns } from './datetime';

const pad = (n: number) => String(n).padStart(2, '0');

interface Col { el: HTMLElement; values: number[]; get(): number; set(v: number): void; focus(): void }

function column(label: string, values: number[], text: (v: number) => string, start: number, onChange: () => void): Col {
  const el = h('div', { class: 'fx-tc-time__col', role: 'listbox', 'aria-label': label });
  let cur = values.includes(start) ? start : values[0]!;
  const opts = values.map((v) => {
    const o = h('div', { class: 'fx-tc-time__opt', role: 'option', 'data-v': String(v), tabindex: '-1' });
    o.textContent = text(v);
    o.addEventListener('click', () => { set(v); o.focus(); });
    return o;
  });
  el.append(...opts);
  const draw = () => {
    for (const o of opts) {
      const on = Number(o.dataset.v) === cur;
      o.setAttribute('aria-selected', on ? 'true' : 'false');
      o.tabIndex = on ? 0 : -1;
    }
    // centre the picked option once the column is on screen (it is built before the surface opens)
    requestAnimationFrame(() => { const o = opts.find((x) => Number(x.dataset.v) === cur); if (o && el.isConnected) el.scrollTop = o.offsetTop - el.offsetTop - (el.clientHeight - o.offsetHeight) / 2; });
  };
  const set = (v: number) => { cur = v; draw(); onChange(); };
  el.addEventListener('keydown', (e) => {
    const i = values.indexOf(cur);
    const to: Record<string, number> = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: values.length - 1, PageUp: i - 5, PageDown: i + 5 };
    if (!(e.key in to)) return;
    e.preventDefault();
    const n = Math.min(values.length - 1, Math.max(0, to[e.key]!));
    set(values[n]!);
    opts[n]?.focus();
  });
  draw();
  return { el, values, get: () => cur, set, focus: () => opts.find((o) => o.tabIndex === 0)?.focus() };
}

export function timeColumns(o: { value: string; hour12: boolean; minuteStep: number }): TimeColumns {
  const m = /^(\d{1,2}):(\d{2})/.exec(o.value);
  const now = new Date();
  let hh = m ? Number(m[1]) : now.getHours();
  const mm = m ? Number(m[2]) : now.getMinutes() - (now.getMinutes() % Math.max(1, o.minuteStep));
  const seconds = /^\d{2}:\d{2}(:\d{2})/.exec(o.value)?.[1] ?? '';
  const step = Math.max(1, Math.min(30, Math.round(o.minuteStep)));
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (!minutes.includes(mm)) { minutes.push(mm); minutes.sort((a, b) => a - b); }
  const out = h('div', { class: 'fx-tc-time', role: 'group', 'aria-label': 'Time' });
  const changed = () => { out.dataset.value = value(); };
  let hourCol: Col, ampm: Col | null = null;
  if (o.hour12) {
    hourCol = column('Hours', Array.from({ length: 12 }, (_, i) => i + 1), String, ((hh + 11) % 12) + 1, changed);
    ampm = column('AM or PM', [0, 1], (v) => (v ? 'PM' : 'AM'), hh >= 12 ? 1 : 0, changed);
  } else {
    hourCol = column('Hours', Array.from({ length: 24 }, (_, i) => i), pad, hh, changed);
  }
  const minCol = column('Minutes', minutes, pad, mm, changed);
  const cols = [hourCol, minCol, ...(ampm ? [ampm] : [])];
  out.append(...cols.map((c) => c.el));
  out.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const at = cols.findIndex((c) => c.el.contains(document.activeElement));
    if (at < 0) return;
    e.preventDefault();
    const dir = (e.key === 'ArrowRight') !== (document.dir === 'rtl') ? 1 : -1;
    cols[(at + dir + cols.length) % cols.length]!.focus();
  });
  function value(): string {
    hh = ampm ? (hourCol.get() % 12) + (ampm.get() ? 12 : 0) : hourCol.get();
    return `${pad(hh)}:${pad(minCol.get())}${seconds}`;
  }
  changed();
  return { el: out, value, focus: () => hourCol.focus() };
}

setTimeFactory(timeColumns);
