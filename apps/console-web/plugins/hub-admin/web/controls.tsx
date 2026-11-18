/**
 * Small shared controls of the Hub screens, on framework controls: a tap-twice button (the second tap runs; a confirm
 * action's token from the first answer rides along), and the hook behind it.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, useRuntime } from '@console/axf/react';
import { runAction } from './data';

type Tone = 'primary' | 'neutral' | 'danger' | 'success' | 'ghost' | 'quiet';

/**
 * One action of a screen through `POST <screen>[/<row>]/<action>`: `run(body)` sends it; a `confirmation_required`
 * answer keeps the token and asks for a second tap, which sends the same body with `confirm`. Toasts the hub's words.
 */
export function useHubAction(screen: string, action: string, row?: string, onDone?: () => void) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const token = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const disarm = () => { setArmed(false); token.current = ''; if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const run = async (body: Record<string, unknown> = {}, method: 'POST' | 'DELETE' = 'POST') => {
    setBusy(true);
    try {
      const r = await runAction(screen, action, token.current ? { ...body, confirm: token.current } : body, row, method);
      if (r.code === 'confirmation_required' && typeof r.confirm === 'string') {
        token.current = r.confirm; setArmed(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(disarm, 15000);
        return r;
      }
      disarm();
      rt.toast(r.message || (r.ok ? 'Done.' : 'Nothing changed.'), r.ok ? 'success' : r.code === 'hub_missing' ? 'warning' : 'danger', 'Hub');
      onDone?.();
      return r;
    } finally { setBusy(false); }
  };
  return { busy, armed, run, disarm };
}

/** A button that runs on the second tap (the first arms it and, for a confirm action, fetches its token). */
export function TapTwice({ label, again, icon, tone = 'neutral', size, disabled, onRun, onArm, armed: armedProp, title }: { label: string; again: string; icon?: string; tone?: Tone; size?: 'sm' | 'md'; disabled?: boolean; onRun: () => void; /** the first tap (a confirm action fetches its token here) */ onArm?: () => void; armed?: boolean; title?: string }) {
  const [armed, setArmed] = useState(false);
  const on = armedProp ?? armed;
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 8000); return () => clearTimeout(t); }, [armed]);
  return (
    <Button tone={on ? 'danger' : tone} icon={icon} size={size} disabled={disabled} title={title} aria-pressed={on} onClick={() => { if (on) { setArmed(false); onRun(); } else { setArmed(true); onArm?.(); } }}>
      {on ? again : label}
    </Button>
  );
}

/** A live clock: re-renders every second while `on`. */
export function useTick(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}

export const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
