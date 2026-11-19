/** lib-recorder engine: pure functions over recorded events (no DOM). */
export type RecEventType = 'move' | 'down' | 'up' | 'click' | 'key' | 'scroll' | 'nav' | 'mark';
/** One event; `t` = seconds from the start, `x` / `y` = fractions of the stage (0..1). */
export interface RecEvent { t: number; type: RecEventType; x?: number; y?: number; key?: string; text?: string; target?: string }
export interface Recording { id: string; name: string; url: string; createdAt: string; duration: number; events: RecEvent[]; videoKey?: string }
export type CueKind = 'move' | 'click' | 'type' | 'scroll' | 'wait' | 'highlight' | 'navigate' | 'say' | 'key';
export interface RecCue { id: string; kind: CueKind; target?: string; text?: string; x?: number; y?: number; dur: number }

let n = 0;
const cid = () => `c-${Date.now().toString(36)}${(n++).toString(36)}`;

/** events → a cue track: clicks become move + click, typed runs one type cue, gaps over `waitAfter` a wait, marks highlights */
export function eventsToCues(events: readonly RecEvent[], waitAfter = 1.5): RecCue[] {
  const out: RecCue[] = [];
  let last = 0, typed = '';
  const flush = () => { if (typed) { out.push({ id: cid(), kind: 'type', text: typed, target: 'focused field', dur: Math.max(0.8, typed.length * 0.07) }); typed = ''; } };
  for (const e of events) {
    const gap = e.t - last;
    if (gap > waitAfter && e.type !== 'move') { flush(); out.push({ id: cid(), kind: 'wait', dur: +Math.min(gap, 5).toFixed(1) }); }
    switch (e.type) {
      case 'click': flush(); out.push({ id: cid(), kind: 'move', x: e.x, y: e.y, target: e.target, dur: 0.6 }, { id: cid(), kind: 'click', x: e.x, y: e.y, target: e.target, dur: 0.3 }); last = e.t; break;
      case 'key': if (e.key && e.key.length === 1) typed += e.key; else if (e.key && ['Enter', 'Tab', 'Escape'].includes(e.key)) { flush(); out.push({ id: cid(), kind: 'key', text: e.key, dur: 0.3 }); } last = e.t; break;
      case 'scroll': flush(); if (out[out.length - 1]?.kind !== 'scroll') out.push({ id: cid(), kind: 'scroll', target: e.target ?? 'page', dur: 0.8 }); last = e.t; break;
      case 'nav': flush(); out.push({ id: cid(), kind: 'navigate', text: e.text, dur: 1.5 }); last = e.t; break;
      case 'mark': flush(); out.push({ id: cid(), kind: 'highlight', x: e.x, y: e.y, target: e.text ?? 'marker', dur: 1.2 }); last = e.t; break;
      default: break;
    }
  }
  flush();
  return out;
}

export interface ReplayFrame { x: number; y: number; ripple: number | null; caption: string | null }
/** cursor position (interpolated), click ripple (0..1) and caption at time t */
export function frameAt(events: readonly RecEvent[], t: number): ReplayFrame {
  let a: RecEvent | null = null, b: RecEvent | null = null;
  for (const e of events) { if (e.x == null) continue; if (e.t <= t) a = e; else { b = e; break; } }
  const k = a && b ? (t - a.t) / Math.max(0.001, b.t - a.t) : 0;
  const x = a ? (b ? a.x! + (b.x! - a.x!) * k : a.x!) : 0.5, y = a ? (b ? a.y! + (b.y! - a.y!) * k : a.y!) : 0.5;
  let click: RecEvent | undefined, cap: RecEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!; if (e.t > t) continue;
    if (!click && e.type === 'click' && t - e.t < 0.5) click = e;
    if (!cap && (e.type === 'key' || e.type === 'mark' || e.type === 'nav') && t - e.t < 1.2) cap = e;
    if (t - e.t > 1.2) break;
  }
  return { x, y, ripple: click ? (t - click.t) / 0.5 : null, caption: cap ? (cap.type === 'key' ? `⌨ ${cap.key}` : cap.text ?? null) : null };
}

/** a short description of an element for the event log ("button#save “Save”") */
export function describeElement(el: Element | null): string {
  if (!el) return '';
  const text = el.textContent?.trim().slice(0, 30);
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${text ? ` “${text}”` : ''}`;
}
