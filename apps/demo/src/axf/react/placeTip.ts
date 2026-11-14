/** Where a tooltip goes: below its control when there is room, else above; never over it; inside the screen. */
export function placeTip(rect: { left: number; top: number; bottom: number; width: number }, size: { w: number; h: number }, view: { w: number; h: number }, gap = 8): { left: number; top: number; side: 'below' | 'above' } {
  const left = Math.max(gap, Math.min(view.w - size.w - gap, rect.left + rect.width / 2 - size.w / 2));
  const below = rect.bottom + gap;
  if (below + size.h <= view.h - gap || rect.top - gap - size.h < gap) return { left, top: Math.min(below, Math.max(gap, view.h - size.h - gap)), side: 'below' };
  return { left, top: rect.top - gap - size.h, side: 'above' };
}
