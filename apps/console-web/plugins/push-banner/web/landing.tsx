/**
 * The landing line (build auto-land-every-finished-build-lands, Brett Nov 13 2026: "what's it gonna take to get you to
 * merge and land what's completed"). Every finished build not on main yet, in landing order, and anything stuck for
 * over 30 minutes with why and its fix build. The banner's "Landing: N" chip opens it; the same data is GET /land/line
 * (REST, MCP push_banner_land_line, CLI land.mjs line, voice "what's stuck landing"). Theme tokens and framework controls only.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Button, Icon } from '@console/axf/react';
import { api } from './store';

export interface LineItem { id: string; pr: number | null; state: string; since?: string; kind: string }
export interface StuckItem { id: string; pr: number | null; kind: string; text: string; since?: string; minutes: number; fix: string }
export interface LandLine { on: boolean; at?: string; line: LineItem[]; stuck: StuckItem[]; chip: { label: string; line: number; ready: number; stuck: number; tone: string } | null; sweep: { at?: string | null; acted: { id: string; act: string; fix?: string }[]; requested?: string } }

const POLL_MS = 60_000;
let lstate: { data: LandLine | null; error: string; note: string } = { data: null, error: '', note: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof lstate>) => { lstate = { ...lstate, ...p }; subs.forEach((f) => f()); };
export const useLandLine = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lstate);

export async function loadLine(): Promise<void> {
  try { set({ data: await api.call<LandLine>('land/line'), error: '' }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
}
let timer: ReturnType<typeof setInterval> | null = null;
export function startLine(): void { if (timer) return; void loadLine(); timer = setInterval(() => void loadLine(), POLL_MS); }

const age = (m: number) => (m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`);

/** The banner chip: how many builds are in the landing line, and how many are stuck over 30 minutes. */
export function LandingChip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const l = useLandLine();
  useEffect(() => { startLine(); }, []);
  const c = l.data?.chip;
  if (!l.data?.on || !c) return null;
  return (
    <button type="button" className={`fx-chip axp-mq__chip is-${c.tone}`} aria-expanded={open} title={`${c.line} finished build${c.line === 1 ? '' : 's'} not on main yet${c.stuck ? `, ${c.stuck} stuck over 30 min` : ''}: open the landing line`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <Icon name="upload" size={14} /> {c.label}{c.stuck ? ` · ${c.stuck} stuck` : ''}
    </button>
  );
}

/** The landing line itself: stuck builds first (why, for how long, the fix build), then the rest in order. */
export function LandingView() {
  const l = useLandLine();
  useEffect(() => { startLine(); }, []);
  const d = l.data;
  if (!d) return l.error ? <p className="fx-small axp-push-banner__note is-danger">{l.error}</p> : null;
  const stuck = new Set(d.stuck.map((x) => x.id));
  const sweep = () => { set({ note: '' }); api.post('land/sweep', {}).then(() => { set({ note: 'The sweeper runs at the next round (within 3 minutes).' }); void loadLine(); }, (e: Error) => set({ note: e.message })); };
  return (
    <div className="fx-stack">
      <div className="axp-push-banner__acts" role="toolbar" aria-label="Landing line">
        <Button size="sm" icon="refresh" onClick={sweep}>Sweep now</Button>
      </div>
      {d.stuck.length > 0 && (
        <ul className="axp-push-banner__list" aria-label="Stuck over 30 minutes">
          {d.stuck.map((x) => (
            <li key={x.id} className="axp-push-banner__item">
              <span className="axp-push-banner__entry">
                <span className="axp-push-banner__line"><span className="axp-push-banner__chip">stuck {age(x.minutes)}</span><span className="axp-push-banner__name">{x.id}{x.pr ? ` #${x.pr}` : ''}</span></span>
                <span className="fx-small fx-muted axp-mq__why">{x.text.replace(`${x.id}: `, '')}{x.fix ? ` Fix build: ${x.fix}.` : ''}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.line.filter((x) => !stuck.has(x.id)).length > 0 && (
        <ul className="axp-push-banner__list" aria-label="Landing line">
          {d.line.filter((x) => !stuck.has(x.id)).map((x) => (
            <li key={x.id} className="axp-push-banner__item">
              <span className="axp-push-banner__entry"><span className="axp-push-banner__line"><span className="axp-push-banner__chip">{x.state}</span><span className="axp-push-banner__name">{x.id}{x.pr ? ` #${x.pr}` : ''}</span></span></span>
            </li>
          ))}
        </ul>
      )}
      {!d.line.length && <p className="fx-small fx-muted">Nothing waiting to land.</p>}
      <p className="fx-small fx-muted">{d.sweep.at ? `Last sweep ${new Date(d.sweep.at).toLocaleTimeString()}: ${d.sweep.acted.length ? d.sweep.acted.map((a) => `${a.id} ${a.act}`).join(', ') : 'nothing to do'}.` : 'The sweeper runs every 10 minutes.'}</p>
      {l.note && <p className="fx-small axp-push-banner__note">{l.note}</p>}
    </div>
  );
}
