/*
 * Named extension points: a view renders <Slot name="plan.top" props={{ … }} />, libraries and plugins contribute
 * content through AxfWebLibrary.slots. A slot with nothing contributed renders nothing, so a plugin can add a box
 * to a view without the view knowing it (and leaves nothing behind when it's removed).
 */
import { createContext, Fragment, useContext, type ReactNode } from 'react';
import type { SlotDef } from '../library';

const SlotsCtx = createContext<Record<string, SlotDef[]>>({});

export function SlotsProvider({ slots, children }: { slots: Record<string, SlotDef[]>; children: ReactNode }) {
  return <SlotsCtx.Provider value={slots}>{children}</SlotsCtx.Provider>;
}

export function Slot({ name, props = {} }: { name: string; props?: Record<string, unknown> }) {
  const defs = useContext(SlotsCtx)[name] ?? [];
  if (!defs.length) return null;
  return <>{defs.map((d) => <Fragment key={d.id}>{d.render(props)}</Fragment>)}</>;
}

export const useSlotFilled = (name: string) => (useContext(SlotsCtx)[name]?.length ?? 0) > 0;
