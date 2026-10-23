/*
 * The assistant's activity icon: the title-bar mark that animates while the assistant works.
 *  - idle      still icon (the active agent's, else sparkles)
 *  - thinking  the model is reasoning or hasn't sent text yet: the icon breathes, a soft halo pulses
 *  - working   text is streaming or a tool runs: an accent arc orbits the icon
 * One plugin-wide store (any chat panel that has a running reply sets it), so every place the plugin draws a title —
 * the chat header in the page and the dialog, the page heading — shows the same state. It also mirrors the state to the
 * runtime counter `ai.working` (1 while busy), so a `status` widget on a banner or toolbar can show it too.
 * Theme tokens only; `prefers-reduced-motion` turns the animation into a steady accent colour.
 */
import { useEffect, useId, useSyncExternalStore } from 'react';
import { Icon, useRuntime } from '@console/axf/react';
import type { LiveReply } from './api';

export type Activity = 'idle' | 'thinking' | 'working';

/** What a live reply is doing right now (pure). */
export function activityOf(live: LiveReply | null | undefined): Activity {
  if (!live || live.done) return 'idle';
  if (live.text || live.tools.some((t) => !t.done)) return 'working';
  return 'thinking';
}

const busy = new Map<string, Activity>();
const subs = new Set<() => void>();
let current: Activity = 'idle';
const recompute = () => {
  const all = [...busy.values()];
  const next: Activity = all.includes('working') ? 'working' : all.includes('thinking') ? 'thinking' : 'idle';
  if (next !== current) { current = next; subs.forEach((f) => f()); }
};
export const activityStore = {
  get: () => current,
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  set(owner: string, a: Activity) { if (a === 'idle') busy.delete(owner); else busy.set(owner, a); recompute(); },
};

/** A chat panel reports its live reply's activity (cleared when it unmounts). */
export function useReportActivity(live: LiveReply | null | undefined): Activity {
  const owner = useId();
  const rt = useRuntime();
  const a = activityOf(live);
  useEffect(() => { activityStore.set(owner, a); }, [owner, a]);
  useEffect(() => () => activityStore.set(owner, 'idle'), [owner]);
  const plugin = usePluginActivity();
  useEffect(() => { rt.setBadge('ai.working', plugin === 'idle' ? 0 : 1); }, [rt, plugin]);
  return a;
}

export const usePluginActivity = (): Activity => useSyncExternalStore(activityStore.subscribe, activityStore.get, activityStore.get);

const LABEL: Record<Activity, string> = { idle: 'Ready', thinking: 'Thinking…', working: 'Working…' };

/** The animated mark. `state` defaults to the plugin-wide activity. */
export function ActivityIcon({ icon = 'sparkles', size = 16, state }: { icon?: string; size?: number; state?: Activity }) {
  const plugin = usePluginActivity();
  const a = state ?? plugin;
  return (
    <span className={`axp-ai-assistant__mark is-${a}`} role="img" aria-label={LABEL[a]} title={LABEL[a]} style={{ width: size + 8, height: size + 8 }}>
      <span className="axp-ai-assistant__mark-ring" aria-hidden="true" />
      <Icon name={icon} size={size} />
    </span>
  );
}
