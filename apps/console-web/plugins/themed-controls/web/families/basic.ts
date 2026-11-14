/**
 * Inline families: checkbox and radio (s9), range and number (s10). Each draws the framework's themed control
 * (`.fx-tc-check`, `.fx-tc-radio`, `.fx-tc-range`, `.fx-tc-number` in framework/ui/axf.css, every value a --fx-tc-*
 * token) and writes back to the hidden original through the host (a click for checked state, the native value setter
 * + input / change for values), so labels, forms and React all see a real user change.
 */
import type { TcProps } from '@console/axf/core/engines/themed-controls';
import type { ElementFamily, Swap, SwapCtx } from '../host';
import { aria, h } from './dom';

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
