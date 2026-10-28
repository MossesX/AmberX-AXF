/**
 * walkthrough@1 (Oct 28 2026): what Molly sends when Brett asks to be shown something. Pure (no DOM): the console's
 * floating window (index.tsx) plays it. Same cleaning as the agent manager's server (`clean_walkthrough`), so a step
 * never runs a script or a link: `do` is a console action spec, `target` a data-axf-id, view id or CSS selector.
 */
export interface WalkStep { say: string; do: string; target: string }
export interface Walkthrough { $axf: 'walkthrough@1'; id: string; title: string; app: string; steps: WalkStep[]; seq?: number; at?: number; source?: string }

const ACTION = /^[a-z][a-z0-9._-]*(:[^\s<>"'`]{0,160})?$/;
const BAD_SCHEME = /^(javascript|data|vbscript|file|https?):/i;

export function cleanWalkthrough(raw: unknown): Walkthrough | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.steps)) return null;
  const steps: WalkStep[] = [];
  for (const s of r.steps.slice(0, 20)) {
    if (!s || typeof s !== 'object') continue;
    const x = s as Record<string, unknown>;
    const say = String(x.say ?? '').trim().slice(0, 600);
    let act = String(x.do ?? '').trim().slice(0, 200);
    let target = String(x.target ?? '').trim().slice(0, 200);
    if (act && (BAD_SCHEME.test(act) || !ACTION.test(act))) act = '';
    if (/[<>{}`]/.test(target) || /^javascript/i.test(target)) target = '';
    if (say) steps.push({ say, do: act, target });
  }
  if (!steps.length) return null;
  const id = String(r.id ?? 'walkthrough').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'walkthrough';
  return {
    $axf: 'walkthrough@1', id, title: String(r.title ?? 'Walkthrough').trim().slice(0, 120), app: String(r.app ?? 'console').slice(0, 40), steps,
    ...(typeof r.seq === 'number' ? { seq: r.seq } : {}), ...(typeof r.at === 'number' ? { at: r.at } : {}), ...(typeof r.source === 'string' ? { source: r.source.slice(0, 40) } : {}),
  };
}

/** Where a step moves to (clamped), and what the buttons can do there. */
export function stepAt(w: Walkthrough, i: number) {
  const at = Math.max(0, Math.min(w.steps.length - 1, i));
  return { at, step: w.steps[at]!, first: at === 0, last: at === w.steps.length - 1, label: `Step ${at + 1} of ${w.steps.length}` };
}

/** The element a target names: `[data-axf-id]`, a view (`[data-view]`), else a CSS selector; null when none or invalid. */
export function targetSelector(target: string): string[] {
  const t = target.trim();
  if (!t) return [];
  const esc = t.replace(/["\\]/g, '');
  return [`[data-axf-id="${esc}"]`, `[data-view="${esc}"]`, `[data-tab="${esc}"]`, `#${/^[a-z][\w-]*$/i.test(t) ? t : '__none__'}`, t];
}

/** Spoken commands in the window: next, back, repeat, stop. */
export function voiceMove(heard: string): 'next' | 'prev' | 'repeat' | 'close' | null {
  const n = heard.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(next|go on|continue|ok next|done|got it)$/.test(n)) return 'next';
  if (/^(back|previous|go back)$/.test(n)) return 'prev';
  if (/^(repeat|again|say again|what)$/.test(n)) return 'repeat';
  if (/^(stop|close|cancel|exit|thanks|thank you)$/.test(n)) return 'close';
  return null;
}
