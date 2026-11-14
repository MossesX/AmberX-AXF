/**
 * Inline families: checkbox and radio (s9), range and number (s10). Each draws the framework's themed control
 * (`.fx-tc-check`, `.fx-tc-radio`, `.fx-tc-range`, `.fx-tc-number` in framework/ui/axf.css, every value a --fx-tc-*
 * token) and writes back to the hidden original through the host (a click for checked state, the native value setter
 * + input / change for values), so labels, forms and React all see a real user change.
 */
import type { TcProps } from '@console/axf/core/engines/themed-controls';
import type { ElementFamily, Swap, SwapCtx } from '../host';
import { aria, button, h, holdRepeat, tokenMs } from './dom';

/* ---------------- shared ---------------- */

/** A click on a themed box inside a <label>: cancel the label's own activation and click the input once. */
function clickThrough(ctx: SwapCtx, el: HTMLElement): void {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (ctx.input.disabled || ctx.input.readOnly) return;
    ctx.input.click();
    el.focus();
  });
}

function baseAria(el: HTMLElement, p: TcProps, ctx: SwapCtx): void {
  const label = p.label.startsWith('#') ? '' : p.label;
  aria(el, {
    'aria-label': label || ctx.labelText() || null,
    'aria-labelledby': p.label.startsWith('#') ? p.label.slice(1) : null,
    'aria-describedby': p.describedBy || null,
    'aria-disabled': p.disabled ? 'true' : null,
    'aria-required': p.required ? 'true' : null,
    'aria-invalid': p.invalid ? 'true' : null,
    'aria-readonly': p.readOnly ? 'true' : null,
  });
}

/* ---------------- checkbox ---------------- */

export const checkboxFamily: ElementFamily = {
  family: 'checkbox',
  selector: 'input[type="checkbox"]',
  // the framework Switch is already a themed control (role="switch" over its own track)
  skip: (i) => i.classList.contains('fx-switch__input') || i.getAttribute('role') === 'switch',
  mount(ctx): Swap {
    const el = h('span', { class: 'fx-tc-check', role: 'checkbox', tabindex: '0' }, h('span', { class: 'fx-tc-check__mark', 'aria-hidden': 'true' }));
    clickThrough(ctx, el);
    el.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); if (!ctx.input.disabled && !ctx.input.readOnly) ctx.input.click(); }
    });
    return {
      el,
      sync(p) {
        const mixed = p.indeterminate === true && !p.checked;
        el.setAttribute('aria-checked', mixed ? 'mixed' : p.checked ? 'true' : 'false');
        el.tabIndex = p.disabled ? -1 : 0;
        baseAria(el, p, ctx);
      },
      state: () => ({ checked: ctx.input.checked, indeterminate: ctx.input.indeterminate, value: ctx.input.value }),
      set(v) { ctx.setChecked(v === true || /^(on|true|1|yes|checked|tick(ed)?)$/i.test(String(v))); },
    };
  },
};

/* ---------------- radio ---------------- */

const radios = new Map<HTMLInputElement, () => void>();

/** The radios of one group (same name, same form), in document order. */
function groupOf(input: HTMLInputElement): HTMLInputElement[] {
  if (!input.name) return [input];
  const scope: ParentNode = input.form ?? input.getRootNode() as ParentNode;
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.name === input.name && r.form === input.form);
}

export const radioFamily: ElementFamily = {
  family: 'radio',
  selector: 'input[type="radio"]',
  mount(ctx): Swap {
    const el = h('span', { class: 'fx-tc-radio', role: 'radio', tabindex: '-1' }, h('span', { class: 'fx-tc-radio__dot', 'aria-hidden': 'true' }));
    clickThrough(ctx, el);
    const render = () => {
      const p = ctx.props();
      el.setAttribute('aria-checked', ctx.input.checked ? 'true' : 'false');
      // roving tab stop: the checked radio of the group, else the first enabled one
      const group = groupOf(ctx.input).filter((r) => !r.disabled);
      const stop = group.find((r) => r.checked) ?? group[0];
      el.tabIndex = !p.disabled && stop === ctx.input ? 0 : -1;
      baseAria(el, p, ctx);
    };
    radios.set(ctx.input, render);
    const move = (dir: 1 | -1 | 'first' | 'last') => {
      const group = groupOf(ctx.input).filter((r) => !r.disabled);
      if (!group.length) return;
      const at = group.indexOf(ctx.input);
      const next = dir === 'first' ? group[0] : dir === 'last' ? group[group.length - 1] : group[(at + dir + group.length) % group.length];
      if (!next) return;
      if (!next.checked) next.click();
      const themed = next.nextElementSibling;
      if (themed instanceof HTMLElement && themed.classList.contains('fx-tc-radio')) themed.focus(); else next.focus();
    };
    el.addEventListener('keydown', (e) => {
      if (ctx.input.disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      else if (e.key === 'Home') { e.preventDefault(); move('first'); }
      else if (e.key === 'End') { e.preventDefault(); move('last'); }
      else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); if (!ctx.input.checked) ctx.input.click(); }
    });
    return {
      el,
      sync() {
        // checking one radio unchecks the others without an event: redraw the whole group
        for (const r of groupOf(ctx.input)) (radios.get(r) ?? (r === ctx.input ? render : null))?.();
      },
      destroy() { radios.delete(ctx.input); for (const r of groupOf(ctx.input)) radios.get(r)?.(); },
      state: () => ({ checked: ctx.input.checked, value: ctx.input.value, group: ctx.input.name, selected: groupOf(ctx.input).find((r) => r.checked)?.value ?? null }),
      set(v) {
        // a value picks that radio of the group; on / true checks this one
        const s = String(v);
        const pick = groupOf(ctx.input).find((r) => r.value === s) ?? (/^(on|true|1|yes|checked)$/i.test(s) ? ctx.input : null);
        if (pick && !pick.checked && !pick.disabled) pick.click();
      },
    };
  },
};

/* ---------------- range ---------------- */

const decimals = (n: number) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
/** Snap to the step grid from `base`, clamp to min / max, keep the step's decimals. */
export function snap(v: number, min: number | null, max: number | null, step: number): number {
  let out = v;
  if (step > 0) {
    const base = min ?? 0;
    out = base + Math.round((out - base) / step) * step;
    out = Number(out.toFixed(Math.max(decimals(step), decimals(base))));
  }
  if (min !== null && out < min) out = min;
  if (max !== null && out > max) out = max;
  return out;
}

function datalistValues(id: string): number[] {
  if (!id) return [];
  const dl = document.getElementById(id);
  if (!(dl instanceof HTMLDataListElement)) return [];
  return Array.from(dl.options).map((o) => Number(o.value)).filter(Number.isFinite);
}

export const rangeFamily: ElementFamily = {
  family: 'range',
  selector: 'input[type="range"]',
  // the framework Slider is drawn by the slider asset already
  skip: (i) => !!i.closest('.fx-slider'),
  mount(ctx): Swap {
    const fill = h('span', { class: 'fx-tc-range__fill' });
    const track = h('span', { class: 'fx-tc-range__track' }, fill);
    const ticks = h('span', { class: 'fx-tc-range__ticks', 'aria-hidden': 'true' });
    const bubble = h('span', { class: 'fx-tc-range__bubble', 'aria-hidden': 'true' });
    const thumb = h('span', { class: 'fx-tc-range__thumb', role: 'slider', tabindex: '0' }, bubble);
    const el = h('span', { class: 'fx-tc-range' }, track, ticks, thumb);
    let p = ctx.props();
    const num = (k: string) => Number(p[k]);
    const vertical = () => p.orient === 'vertical';
    const commit = (v: number, done: boolean) => {
      const next = snap(v, num('min'), num('max'), num('step'));
      if (String(next) !== ctx.input.value || done) ctx.setValue(String(next), done);
    };
    const fromPointer = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      const ratio = vertical() ? 1 - (e.clientY - r.top) / (r.height || 1) : (document.dir === 'rtl' ? r.right - e.clientX : e.clientX - r.left) / (r.width || 1);
      return num('min') + Math.min(1, Math.max(0, ratio)) * (num('max') - num('min'));
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || ctx.input.disabled || ctx.input.readOnly) return;
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      el.dataset.dragging = 'true';
      thumb.focus();
      commit(fromPointer(e), false);
      const move = (ev: PointerEvent) => commit(fromPointer(ev), false);
      const up = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        delete el.dataset.dragging;
        commit(fromPointer(ev), true);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    thumb.addEventListener('keydown', (e) => {
      if (ctx.input.disabled || ctx.input.readOnly) return;
      const step = num('step') || (num('max') - num('min')) / 100;
      const big = Math.max(step, (num('max') - num('min')) / 10);
      const v = Number(ctx.input.value);
      const map: Record<string, number> = { ArrowRight: v + step, ArrowUp: v + step, ArrowLeft: v - step, ArrowDown: v - step, PageUp: v + big, PageDown: v - big, Home: num('min'), End: num('max') };
      if (!(e.key in map)) return;
      e.preventDefault();
      commit(map[e.key]!, true);
    });
    return {
      el,
      focusEl: () => thumb,
      sync(next) {
        p = next;
        const min = num('min'), max = num('max'), v = Number(p.value);
        const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
        el.style.setProperty('--tc-pct', `${pct}%`);
        el.style.setProperty('--tc-pct-n', String(pct / 100));
        el.dataset.orient = vertical() ? 'vertical' : 'horizontal';
        thumb.tabIndex = p.disabled ? -1 : 0;
        bubble.textContent = String(v);
        aria(thumb, { 'aria-valuemin': String(min), 'aria-valuemax': String(max), 'aria-valuenow': String(v), 'aria-valuetext': ctx.input.getAttribute('aria-valuetext') || null, 'aria-orientation': vertical() ? 'vertical' : null });
        baseAria(thumb, p, ctx);
        const tv = datalistValues(String(p.list ?? ''));
        if (ticks.childElementCount !== tv.length || ticks.dataset.sig !== tv.join(',')) {
          ticks.replaceChildren(...tv.filter((t) => t >= min && t <= max).map((t) => { const s = h('span', { class: 'fx-tc-range__tick' }); s.style.setProperty('--tc-at', `${max > min ? ((t - min) / (max - min)) * 100 : 0}%`); return s; }));
          ticks.dataset.sig = tv.join(',');
        }
        el.toggleAttribute('data-disabled', !!p.disabled);
        el.toggleAttribute('data-invalid', !!p.invalid);
      },
      state: () => ({ value: Number(ctx.input.value), min: num('min'), max: num('max'), step: num('step') }),
      set(v) { const n = Number(v); if (Number.isFinite(n)) commit(n, true); },
    };
  },
};

/* ---------------- number ---------------- */

export const numberFamily: ElementFamily = {
  family: 'number',
  selector: 'input[type="number"]',
  mount(ctx): Swap {
    const field = h('input', { type: 'text', class: 'fx-input fx-tc-number__field', role: 'spinbutton', autocomplete: 'off' });
    const dec = button('Decrease', { cls: 'fx-tc-number__step fx-tc-number__dec', text: '−' });
    const inc = button('Increase', { cls: 'fx-tc-number__step fx-tc-number__inc', text: '+' });
    dec.tabIndex = -1;
    inc.tabIndex = -1;
    const el = h('span', { class: 'fx-tc-number' }, dec, field, inc);
    let p = ctx.props();
    const lim = (k: 'min' | 'max') => (p[k] === null || p[k] === undefined ? null : Number(p[k]));
    const stepOf = () => Number(p.step) || 1;
    const current = () => { const n = Number(field.value.trim().replace(',', '.')); return Number.isFinite(n) && field.value.trim() !== '' ? n : lim('min') ?? 0; };
    const commit = (v: number, done = true) => ctx.setValue(String(snap(v, lim('min'), lim('max'), Number(p.step) || 0)), done);
    const by = (n: number) => { if (!ctx.input.disabled && !ctx.input.readOnly) commit(current() + n * stepOf()); };
    const timing = () => ({ delay: tokenMs('--fx-tc-number-repeat-delay-ms', 400), every: tokenMs('--fx-tc-number-repeat-ms', 80) });
    holdRepeat(dec, () => by(-1), timing);
    holdRepeat(inc, () => by(1), timing);
    field.addEventListener('input', () => {
      const t = field.value.trim().replace(',', '.');
      if (t === '' || Number.isFinite(Number(t))) ctx.setValue(t, false);
    });
    field.addEventListener('change', () => { const t = field.value.trim(); if (t === '') ctx.setValue('', true); else commit(current()); });
    field.addEventListener('keydown', (e) => {
      const keys: Record<string, () => void> = {
        ArrowUp: () => by(1), ArrowDown: () => by(-1), PageUp: () => by(10), PageDown: () => by(-10),
        Home: () => { const m = lim('min'); if (m !== null) commit(m); }, End: () => { const m = lim('max'); if (m !== null) commit(m); },
        Enter: () => { if (field.value.trim() !== '') commit(current()); ctx.input.form?.requestSubmit?.(); },
      };
      const f = keys[e.key];
      if (!f || ((e.key === 'Home' || e.key === 'End') && lim(e.key === 'Home' ? 'min' : 'max') === null)) return;
      e.preventDefault();
      f();
    });
    return {
      el,
      focusEl: () => field,
      sync(next) {
        p = next;
        // while typing, keep what is typed ("1." stays) unless the value really changed elsewhere
        const typed = field.value.trim().replace(',', '.');
        if (document.activeElement !== field || (typed !== '' && Number(typed) !== Number(p.value)) || (typed === '' && p.value !== '')) field.value = String(p.value ?? '');
        field.placeholder = String(p.placeholder ?? '');
        field.inputMode = String(p.inputMode ?? 'numeric');
        field.disabled = !!p.disabled;
        field.readOnly = !!p.readOnly;
        const min = lim('min'), max = lim('max'), v = p.value === '' ? null : Number(p.value);
        aria(field, { 'aria-valuemin': min === null ? null : String(min), 'aria-valuemax': max === null ? null : String(max), 'aria-valuenow': v === null || !Number.isFinite(v) ? null : String(v) });
        baseAria(field, p, ctx);
        dec.disabled = !!p.disabled || !!p.readOnly || (min !== null && v !== null && v <= min);
        inc.disabled = !!p.disabled || !!p.readOnly || (max !== null && v !== null && v >= max);
        el.toggleAttribute('data-disabled', !!p.disabled);
        el.toggleAttribute('data-invalid', !!p.invalid);
      },
      state: () => ({ value: ctx.input.value === '' ? null : Number(ctx.input.value), min: lim('min'), max: lim('max'), step: stepOf() }),
      set(v) { const s = String(v ?? '').trim(); if (s === '') ctx.setValue('', true); else if (Number.isFinite(Number(s))) commit(Number(s)); },
    };
  },
};
