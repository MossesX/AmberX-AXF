/**
 * Every themed control is a console-control target (themed-controls@1 → API: "A themed control"): kind `setting`,
 * address `setting:field.<ref>` (ref = the element id, else its name; a radio group is one target by its name), so
 * `state` reads its value, `set` changes it like a person would (the original input gets input / change), `focus`
 * scrolls to it. The same is reachable as the action `themed-controls.set:<ref>:<value>` and the server routes
 * GET /controls, POST /set (REST, MCP themed-controls_set, CLI `axf themed-controls set --ref … --value …`).
 */
import type { AxfRuntime } from '@console/axf/core';
import { THEMED_FAMILY_LABELS } from '@console/axf/core/engines/themed-controls';
import { controlRegistry } from '@console/axf/react';
import type { SwapRecord } from './host';

export const fieldAddress = (ref: string) => `setting:field.${ref.replace(/%/g, '%25').replace(/\//g, '%2F')}`;

/** The group-level ref of a record (a radio group is one control). */
export const targetRef = (r: SwapRecord) => (r.family === 'radio' && r.input.name ? r.input.name : r.ref);

const held = new Map<string, { count: number; off: () => void }>();

function labelOf(r: SwapRecord): string {
  const p = (r.swap.focusEl?.() ?? r.swap.el).getAttribute('aria-label');
  if (r.family === 'radio') {
    const legend = r.input.closest('fieldset')?.querySelector('legend')?.textContent?.trim();
    return legend || r.input.name;
  }
  return (p || r.input.labels?.[0]?.textContent || r.input.name || r.ref).replace(/\s+/g, ' ').trim();
}

/** Register the target of one swap; returns the remover (a radio group stays until its last radio goes). */
export function registerSwapTarget(rt: AxfRuntime, r: SwapRecord): () => void {
  const ref = targetRef(r);
  const address = fieldAddress(ref);
  const have = held.get(address);
  if (have) { have.count++; return () => release(address); }
  const off = controlRegistry(rt).register({
    address, kind: 'setting', label: labelOf(r), detail: `Themed ${THEMED_FAMILY_LABELS[r.family].toLowerCase().replace(/s$/, '')} · ${ref}`, icon: 'sliders',
    keywords: [ref, r.family, r.input.name].filter(Boolean),
    can: ['state', 'set', 'focus'],
    element: () => r.swap.el,
    get: () => r.swap.state?.() ?? { value: r.input.value },
    state: () => ({ family: r.family, ref, ...(r.swap.state?.() ?? {}) }),
    set: (v) => r.swap.set?.(v),
    isDisabled: () => r.input.disabled,
  });
  held.set(address, { count: 1, off });
  return () => release(address);
}

function release(address: string): void {
  const h = held.get(address);
  if (!h) return;
  if (--h.count <= 0) { held.delete(address); h.off(); }
}

/** A compact list of the themed controls on the page (the live report and GET /controls). */
export function controlList(records: SwapRecord[], max = 200): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const r of records) {
    const ref = targetRef(r);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const st = r.swap.state?.() ?? {};
    out.push({ ref, family: r.family, label: labelOf(r), address: fieldAddress(ref), ...(r.family === 'radio' ? { value: st.selected ?? null } : 'value' in st ? { value: st.value } : {}), ...('checked' in st && r.family === 'checkbox' ? { checked: st.checked } : {}), ...(r.family === 'file' ? { files: st.files } : {}), ...(r.input.disabled ? { disabled: true } : {}) });
    if (out.length >= max) break;
  }
  return out;
}
