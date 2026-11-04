/*
 * Repeating slots (layout.repeat, core/engines/repeat.ts). A page declares its data sets with <PageDataSets sets={…}>;
 * <RepeatingSlot id="…"> draws one item per entry of the set the active layout names, in the layout's style (tabs,
 * cards, grid, stacked), or the slot's fallback when the page declares none or it is empty. Swapping the layout swaps
 * the style; the page never decides it.
 */
import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { compileRepeat, compileRepeats, repeatsIn, repeatVars, type CompiledRepeat, type PageDataSets as DataSets, type RepeatItem } from '../../core/engines/repeat';
import type { RepeatFallback } from '../../core/types';
import type { SlotRegion } from '../../core/engines/layout';
import { useAsset } from '../AxfProvider';
import { Container } from './Controls';
import { Icon } from './Icon';

const DataSetsCtx = createContext<DataSets>({});

/** A page declares the data sets its layout's repeating slots draw from; nested declarations add to (and override) outer ones. */
export function PageDataSets({ sets, children }: { sets: DataSets; children: ReactNode }) {
  const outer = useContext(DataSetsCtx);
  const merged = useMemo(() => ({ ...outer, ...sets }), [outer, sets]);
  return <DataSetsCtx.Provider value={merged}>{children}</DataSetsCtx.Provider>;
}

export const usePageDataSets = (): DataSets => useContext(DataSetsCtx);

export interface RepeatRenderProps {
  /** draws one item; default its label */
  renderItem?: (item: RepeatItem, slot: CompiledRepeat) => ReactNode;
  /** draws the fallback slot when the data set is missing or empty; default the fallback's label */
  renderFallback?: (fallback: RepeatFallback, slot: CompiledRepeat) => ReactNode;
}

/** One repeating slot of the active layout, by id. Draws nothing when the layout has no slot by that id. */
export function RepeatingSlot({ id, ...render }: { id: string } & RepeatRenderProps) {
  const layout = useAsset('layout').data;
  const sets = usePageDataSets();
  const [active, setActive] = useState<Record<string, string>>({});
  const def = (Array.isArray(layout.repeat) ? layout.repeat : []).find((d) => d?.id === id);
  const slot = def ? compileRepeat(def, sets, active) : null;
  if (!slot) return null;
  return <RepeatView slot={slot} onSelect={(key) => setActive((a) => ({ ...a, [id]: key }))} {...render} />;
}

/** Every repeating slot the active layout puts in `region`, in order. */
export function RepeatingSlots({ region, ...render }: { region: SlotRegion } & RepeatRenderProps) {
  const layout = useAsset('layout').data;
  const sets = usePageDataSets();
  const [active, setActive] = useState<Record<string, string>>({});
  const slots = repeatsIn(compileRepeats(layout, sets, active), region);
  return <>{slots.map((s) => <RepeatView key={s.id} slot={s} onSelect={(key) => setActive((a) => ({ ...a, [s.id]: key }))} {...render} />)}</>;
}

/** Draws a compiled slot. Exported so a view can draw a slot it compiled itself (a preview, a studio). */
export function RepeatView({ slot, onSelect, renderItem, renderFallback }: { slot: CompiledRepeat; onSelect?: (key: string) => void } & RepeatRenderProps) {
  const item = (it: RepeatItem) => (renderItem ? renderItem(it, slot) : it.label);
  const attrs = { 'data-fx-repeat': slot.id, 'data-fx-repeat-style': slot.style, 'data-fx-dataset': slot.dataSet };
  if (slot.empty) {
    const f = slot.fallback ?? {};
    const body = renderFallback ? renderFallback(f, slot) : f.label;
    if (body == null || body === false) return null;
    return <div className="fx-repeat fx-repeat--fallback" {...attrs} data-fx-fallback-type={f.type} data-fx-fallback-id={f.id}>{body}</div>;
  }
  const more = slot.overflow > 0 ? <div className="fx-repeat__more">+{slot.overflow}</div> : null;
  if (slot.style === 'tabs') {
    const current = slot.items.find((it) => it.key === slot.active) ?? slot.items[0];
    if (!current) return null;
    return (
      <div className="fx-repeat fx-repeat--tabs" {...attrs}>
        <div className="fx-tabs" role="tablist">
          {slot.items.map((it) => (
            <button key={it.key} type="button" role="tab" aria-selected={it.key === current.key} className={`fx-tab ${it.key === current.key ? 'is-active' : ''}`} onClick={() => onSelect?.(it.key)}>
              {it.icon && <Icon name={it.icon} size={14} />}
              {it.label}
            </button>
          ))}
          {more}
        </div>
        <div className="fx-repeat__panel" role="tabpanel">{item(current)}</div>
      </div>
    );
  }
  const style = repeatVars(slot) as CSSProperties;
  return (
    <div className={`fx-repeat fx-repeat--${slot.style}`} {...attrs} style={style}>
      {slot.items.map((it) =>
        slot.style === 'cards'
          ? <Container key={it.key} title={it.label} icon={it.icon ?? undefined} className="fx-repeat__item">{item(it)}</Container>
          : <div key={it.key} className="fx-repeat__item">{item(it)}</div>,
      )}
      {more}
    </div>
  );
}
