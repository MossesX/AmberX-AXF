/*
 * Model & thinking (model-advice@1, Brett, Nov 4 2026): everywhere a build or a step is shown, two chips (the model it is
 * on, plus the recommended one when it differs; the thinking level) and one icon: a green check when it is all set, a
 * yellow triangle when the recommendation differs or built work needs a look. Right-click / long-press the icon and
 * the row expands with WHY (now vs recommended, the reasons, what could go wrong if left as is, the cost to change)
 * and Apply / Dismiss, which only Brett can do (the orchestrator refuses a session). One component for every screen:
 * Build manager, Builds, Pending, Queue, Build orchestrator, Plan Studio, Crew, Home cards, Codebase changes.
 *
 * On / off: Settings → Builds → "Show model & thinking" (global), with a per-screen override; filters (model, thinking,
 * status, Needs a look, Fable candidates) are one shared setting every list reads; console actions `model-advice.show`,
 * `model-advice.filter` and `model-advice.screen` flip them (so Amber can, by voice). Everything visual comes from
 * theme tokens (fx-chip tones, --fx-success / --fx-warning); the icons are the framework's.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { AxfRuntime, SettingsGroup } from '../../core';
import { REVIEW_ICON, VERDICT_LABEL, buildView, defaultThinking, filterIsEmpty, filterLabel, matchesFilter, normFilter, parseFilter, stepView, whyLines, type AdviceFilter } from '../../core/model-advice.mjs';
import { useOptionalRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { Button } from './Controls';

/** What a screen hands the chips: the engine's BuildView / StepView, or the same fields read off a projection (plain strings). */
export interface AdviceView { model: string; thinking: string; recommendedModel: string; recommendedThinking: string; reviewStatus: string; modelWhy?: string; adviceKind?: string; verdict?: string; adviceCost?: { minutes: number; usd: number; what: string } | null; stepsToLook?: number; build?: string }
/** A change for the orchestrator: apply-advice / dismiss-advice / set-thinking on a build (and a step). */
export type AdviceChange = { action: 'apply-advice' | 'dismiss-advice' | 'set-thinking'; id: string; step?: string; thinking?: string; note?: string };
export type AdviceActor = (change: AdviceChange) => Promise<boolean>;

export const MODEL_THINKING_KEY = 'axf.builds.showModelThinking';
export const ADVICE_FILTER_KEY = 'axf.builds.adviceFilter';
export const modelThinkingScreenKey = (screen: string) => `${MODEL_THINKING_KEY}.${screen}`;
/** Every screen with its own override (Settings → Builds). */
export const ADVICE_SCREENS = [
  { id: 'build-manager', label: 'Build manager' }, { id: 'builds', label: 'Builds' }, { id: 'pending', label: 'Pending builds' }, { id: 'queue', label: 'Build queue' },
  { id: 'orchestrator', label: 'Build orchestrator' }, { id: 'plan-studio', label: 'Plan Studio' }, { id: 'crew', label: 'Crew' }, { id: 'home', label: 'Home cards' },
  { id: 'changes', label: 'Codebase changes' }, { id: 'requests', label: 'Requests ledger' }, { id: 'git', label: 'Git board' },
] as const;
export type AdviceScreen = (typeof ADVICE_SCREENS)[number]['id'];

/* ---------------- the actor (who talks to the orchestrator) ---------------- */

let actor: AdviceActor | null = null;
/** The app registers how Apply / Dismiss reach the orchestrator (the console: its build-orchestrator route). */
export function setModelAdviceActor(fn: AdviceActor | null) { actor = fn; }

/* ---------------- settings: on / off, per screen, the filter ---------------- */

function useSettingsRev(rt: AxfRuntime | null) {
  return useSyncExternalStore(rt ? rt.settings.subscribe : () => () => {}, rt ? rt.settings.getRevision : () => 0, () => 0);
}
/** Is the model & thinking layer shown on this screen? (global switch, then the screen's inherit / on / off) */
export function modelThinkingShown(rt: AxfRuntime | null, screen?: string): boolean {
  if (!rt) return true;
  const global = rt.settings.get(MODEL_THINKING_KEY) !== false;
  const own = screen ? rt.settings.get(modelThinkingScreenKey(screen)) : null;
  return own === 'on' ? true : own === 'off' ? false : global;
}
export function useModelThinkingShown(screen?: string): boolean {
  const rt = useOptionalRuntime();
  useSettingsRev(rt);
  return modelThinkingShown(rt, screen);
}
export function readAdviceFilter(rt: AxfRuntime | null): AdviceFilter {
  if (!rt) return {};
  try { const v = rt.settings.get(ADVICE_FILTER_KEY); return normFilter(typeof v === 'string' && v ? JSON.parse(v) : {}); } catch { return {}; }
}
export function writeAdviceFilter(rt: AxfRuntime, f: AdviceFilter | string) {
  const n = typeof f === 'string' ? parseFilter(f) : normFilter(f);
  rt.settings.set(ADVICE_FILTER_KEY, filterIsEmpty(n) ? '' : JSON.stringify(n));
}
/** The shared filter every build / step list applies (one setting, so a voice command filters every screen). */
export function useAdviceFilter(): [AdviceFilter, (f: AdviceFilter | string) => void] {
  const rt = useOptionalRuntime();
  useSettingsRev(rt);
  const set = useCallback((f: AdviceFilter | string) => { if (rt) writeAdviceFilter(rt, f); }, [rt]);
  return [readAdviceFilter(rt), set];
}
export { matchesFilter, filterLabel, filterIsEmpty, buildView, stepView, whyLines };

/** The Settings → Builds group: the global switch and one override per screen. */
export function modelThinkingSettingsGroup(): SettingsGroup {
  return {
    id: 'model-thinking', label: 'Model & thinking', icon: 'sparkles', tab: 'builds', order: 10,
    description: 'Next to every build and step: the model it is on, the thinking level, the recommended ones and a check (all set) or a triangle (needs a look). Off hides the chips and icons everywhere; the recommendations stay stored.',
    settings: [
      { key: MODEL_THINKING_KEY, label: 'Show model & thinking', kind: 'toggle', default: true, description: 'Every screen that shows a build or a step, unless a screen below says otherwise.' },
      ...ADVICE_SCREENS.map((s) => ({ key: modelThinkingScreenKey(s.id), label: s.label, kind: 'choice' as const, default: 'inherit', options: [{ value: 'inherit', label: 'Follow the switch above' }, { value: 'on', label: 'Always show' }, { value: 'off', label: 'Hide here' }] })),
    ],
  };
}
/** Install once per app: the Builds settings tab + group and the console actions (voice: "show model and thinking", "filter needs a look"). */
export function installModelAdvice(rt: AxfRuntime): () => void {
  if (!rt.settings.getTab('builds')) rt.settings.addTab({ id: 'builds', label: 'Builds', icon: 'layers', order: 35, description: 'How builds and steps are shown: model & thinking recommendations, filters.' });
  rt.settings.addGroup(modelThinkingSettingsGroup());
  const offs = [
    rt.actions.register('model-advice.show', ([v]) => { const on = v === 'on' ? true : v === 'off' ? false : rt.settings.get(MODEL_THINKING_KEY) === false; rt.settings.set(MODEL_THINKING_KEY, on); rt.toast(`Model & thinking ${on ? 'shown' : 'hidden'} on every screen`, 'info'); }, { label: 'Show or hide model & thinking (on / off / toggle)', keywords: ['model', 'thinking', 'fable', 'opus', 'chips', 'recommend'], params: true } as never),
    rt.actions.register('model-advice.filter', (args) => { const words = (args ?? []).join(' '); writeAdviceFilter(rt, words); const f = readAdviceFilter(rt); rt.toast(filterIsEmpty(f) ? 'Build filters cleared' : `Builds filtered: ${filterLabel(f)}`, 'info'); }, { label: 'Filter builds and steps (needs a look · fable candidates · model:Opus · thinking:high · clear)', keywords: ['filter', 'needs a look', 'fable candidates', 'model', 'thinking'], params: true } as never),
    rt.actions.register('model-advice.screen', ([screen, v]) => { if (!screen) return; const val = v === 'on' || v === 'off' ? v : 'inherit'; rt.settings.set(modelThinkingScreenKey(screen), val); rt.toast(`Model & thinking on ${screen}: ${val}`, 'info'); }, { label: 'Model & thinking on one screen (screen, on / off / inherit)', keywords: ['model', 'thinking', 'screen'], params: true } as never),
  ];
  return () => { for (const off of offs) off(); rt.settings.removeGroup('model-thinking'); };
}

/* ---------------- chips, the icon, the why-panel ---------------- */

const MODEL_TONE: Record<string, string> = { Fable: 'fx-chip--accent', Opus: 'fx-chip--success' };
const THINKING_TITLE: Record<string, string> = { low: 'low thinking: routine work', medium: 'medium thinking', high: 'high thinking: hard or foundation work', max: 'max thinking: kernel, migrations, cross-port contracts' };

export function ModelChip({ model, recommended, compact }: { model: string; recommended?: string; compact?: boolean }) {
  const diff = recommended && recommended !== model;
  return (
    <span className={`fx-chip fx-advice__model ${MODEL_TONE[model] ?? ''}`} data-axf-model={model.toLowerCase()} title={diff ? `On ${model}; ${recommended} recommended` : `On ${model}`}>
      {model}{diff && <span className="fx-advice__rec" aria-label={`${recommended} recommended`}><Icon name="chevron-right" size={11} />{compact ? recommended.slice(0, 1) : recommended}</span>}
    </span>
  );
}
export function ThinkingChip({ thinking, recommended, model }: { thinking: string; recommended?: string; model?: string }) {
  const t = thinking || defaultThinking(model ?? 'Opus');
  const diff = recommended && recommended !== t;
  return (
    <span className="fx-chip fx-advice__thinking" data-axf-thinking={t} title={`${THINKING_TITLE[t] ?? t}${diff ? `; ${recommended} recommended` : ''}`}>
      <Icon name="zap" size={11} />{t}{diff && <span className="fx-advice__rec" aria-label={`${recommended} thinking recommended`}><Icon name="chevron-right" size={11} />{recommended}</span>}
    </span>
  );
}

/** The check / the triangle. Right-click or long-press opens the why; a plain click is left to the row. */
export function ReviewIcon({ view, onWhy, open }: { view: AdviceView; onWhy?: () => void; open?: boolean }) {
  const timer = useRef<number | undefined>(undefined);
  const status = view.reviewStatus || 'ok';
  const look = status === 'look';
  const title = look ? `Needs a look: ${view.recommendedModel || view.model} · ${view.recommendedThinking || ''} recommended${view.verdict ? ` (${VERDICT_LABEL[view.verdict as keyof typeof VERDICT_LABEL] ?? view.verdict})` : ''}. Right-click or long-press for why.` : status === 'dismissed' ? 'All set: Brett OK\'d it as is. Right-click for why.' : 'All set: on its recommendation. Right-click for why.';
  const down = (e: RPointerEvent) => { if (e.pointerType === 'mouse' || !onWhy) return; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => onWhy(), 500); };
  const up = () => window.clearTimeout(timer.current);
  return (
    <span className={`fx-advice__icon is-${status}${open ? ' is-open' : ''}`} role={onWhy ? 'button' : undefined} tabIndex={onWhy ? 0 : undefined} aria-label={title} title={title} data-axf-review={status}
      onContextMenu={(e: RMouseEvent) => { if (!onWhy) return; e.preventDefault(); e.stopPropagation(); onWhy(); }}
      onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
      onKeyDown={(e) => { if (onWhy && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); onWhy(); } }}>
      <Icon name={REVIEW_ICON[status as keyof typeof REVIEW_ICON] ?? 'check-circle'} size={14} />
    </span>
  );
}

/** The expansion under a row: why, what could go wrong, the cost, Apply / Dismiss (Brett only; a session is refused). */
export function WhyPanel({ view, build, step, onAct, onClose, title }: { view: AdviceView; build: string; step?: string; onAct?: AdviceActor; onClose?: () => void; title?: string }) {
  const rt = useOptionalRuntime();
  const [busy, setBusy] = useState(false);
  const act = onAct ?? actor;
  const lines = whyLines(view);
  const look = view.reviewStatus === 'look';
  const run = async (change: AdviceChange) => {
    if (!act) { rt?.toast('Apply and Dismiss go through the Build orchestrator (Brett only).', 'info'); return; }
    setBusy(true);
    try { if (await act(change)) { rt?.toast(change.action === 'apply-advice' ? 'Recommendation applied' : 'OK\'d as is: it shows a check now', 'success'); onClose?.(); } }
    finally { setBusy(false); }
  };
  return (
    <div className="fx-advice__why" role="region" aria-label={`Why: ${title ?? build}${step ? ` ${step}` : ''}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <dl className="fx-advice__lines">
        {lines.map((l) => <div key={l.label} className="fx-advice__line"><dt>{l.label}</dt><dd>{l.text}</dd></div>)}
        {view.stepsToLook ? <div className="fx-advice__line"><dt>Steps</dt><dd>{view.stepsToLook} step(s) need a look (open the build to see each one)</dd></div> : null}
      </dl>
      <div className="fx-advice__actions" role="toolbar" aria-label="Recommendation">
        {look && <Button size="sm" tone="primary" icon="check" disabled={busy} title="Move it onto the recommended model and thinking (a raise to Fable is the upgrade approval). Only Brett." onClick={() => void run({ action: 'apply-advice', id: build, step })}>Apply recommendation</Button>}
        {look && <Button size="sm" icon="check-circle" disabled={busy} title="Leave it as it is and turn the triangle into a check. Only Brett." onClick={() => void run({ action: 'dismiss-advice', id: build, step })}>Dismiss (OK as is)</Button>}
        {!look && <span className="fx-small fx-muted">Nothing to change.</span>}
        {onClose && <Button size="sm" icon="x" onClick={onClose}>Close</Button>}
      </div>
    </div>
  );
}

/**
 * The chips + icon for one build or step. `host="inline"` (default) renders the why-panel right after the chips, full
 * width, so inside a wrapping row it drops under the row; `host="row"` leaves the panel to the screen (it calls
 * `onWhy` and renders <WhyPanel> in the row's own expansion). Renders nothing while the layer is hidden for `screen`.
 */
export function ModelChips({ view, screen, build, step, onAct, host = 'inline', onWhy, whyOpen, compact, title }: { view: AdviceView | null | undefined; screen?: string; build?: string; step?: string; onAct?: AdviceActor; host?: 'inline' | 'row'; onWhy?: () => void; whyOpen?: boolean; compact?: boolean; title?: string }) {
  const shown = useModelThinkingShown(screen);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!shown) setOpen(false); }, [shown]);
  if (!shown || !view) return null;
  const toggle = host === 'row' ? onWhy : () => setOpen((o) => !o);
  const isOpen = host === 'row' ? !!whyOpen : open;
  return (
    <>
      <span className={`fx-advice${compact ? ' fx-advice--compact' : ''}`} data-axf-advice={view.reviewStatus}>
        {/* built work judged "keep" shows what it ran on, without an arrow: there is nothing to move */}
        <ModelChip model={view.model} recommended={view.verdict === 'keep' ? undefined : view.recommendedModel} compact={compact} />
        {!compact && <ThinkingChip thinking={view.thinking} recommended={view.verdict === 'keep' ? undefined : view.recommendedThinking} model={view.model} />}
        {build && <ReviewIcon view={view} onWhy={toggle} open={isOpen} />}
      </span>
      {host === 'inline' && open && build && <WhyPanel view={view} build={build} step={step} onAct={onAct} onClose={() => setOpen(false)} title={title} />}
    </>
  );
}

/** Per-screen state for `host="row"`: which rows show their why-panel instead of their usual details. */
export function useWhyRows(): { isOpen: (id: string) => boolean; toggle: (id: string) => void; close: (id: string) => void } {
  const [open, setOpen] = useState<string[]>([]);
  return {
    isOpen: (id) => open.includes(id),
    toggle: (id) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id])),
    close: (id) => setOpen((o) => o.filter((x) => x !== id)),
  };
}

/* ---------------- the filter bar (every build / step list) ---------------- */

const THINKING_OPTS = ['low', 'medium', 'high', 'max'];
export function AdviceFilterBar({ screen, counts, children }: { screen?: string; counts?: { look?: number; fable?: number }; children?: ReactNode }) {
  const shown = useModelThinkingShown(screen);
  const [f, set] = useAdviceFilter();
  if (!shown) return null;
  const flip = (k: 'needsLook' | 'fable') => set({ ...f, [k]: f[k] ? undefined : true } as AdviceFilter);
  return (
    <div className="fx-advice__filters" role="toolbar" aria-label="Model & thinking filters">
      <button type="button" className={`fx-chip${f.needsLook ? ' is-on' : ''}`} aria-pressed={!!f.needsLook} onClick={() => flip('needsLook')} title="Only builds and steps with a yellow triangle"><Icon name="alert" size={12} />Needs a look{counts?.look != null ? ` ${counts.look}` : ''}</button>
      <button type="button" className={`fx-chip${f.fable ? ' is-on' : ''}`} aria-pressed={!!f.fable} onClick={() => flip('fable')} title="Recommended Fable but not on it, or built work to review / redo on Fable"><Icon name="sparkles" size={12} />Fable candidates{counts?.fable != null ? ` ${counts.fable}` : ''}</button>
      <select className="fx-input fx-advice__pick" aria-label="Model" value={f.model ?? ''} onChange={(e) => set({ ...f, model: (e.target.value || undefined) as AdviceFilter['model'] })}><option value="">Any model</option><option value="Fable">On Fable</option><option value="Opus">On Opus</option></select>
      <select className="fx-input fx-advice__pick" aria-label="Thinking" value={f.thinking ?? ''} onChange={(e) => set({ ...f, thinking: (e.target.value || undefined) as AdviceFilter['thinking'] })}><option value="">Any thinking</option>{THINKING_OPTS.map((t) => <option key={t} value={t}>{t} thinking</option>)}</select>
      <select className="fx-input fx-advice__pick" aria-label="Review status" value={f.status ?? ''} onChange={(e) => set({ ...f, status: (e.target.value || undefined) as AdviceFilter['status'] })}><option value="">Check or triangle</option><option value="ok">All set ✓</option><option value="look">Needs a look ⚠</option></select>
      {!filterIsEmpty(f) && <button type="button" className="fx-chip is-on" onClick={() => set({})} title="Clear the model & thinking filters"><Icon name="x" size={12} />{filterLabel(f)}</button>}
      {children}
    </div>
  );
}
