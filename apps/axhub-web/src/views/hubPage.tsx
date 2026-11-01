/**
 * What every hub page of this app shares: the sign-in gate (signed out / must pick a new password / not an admin),
 * a JSON loader with refresh and polling, and a copy button. Framework controls only, theme tokens only.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Note, useRuntime } from '../axf/react';
import { OLD_HUB, hubGet, useHubSession, type HubSession } from '../hub/api';
import { sameJson, shownError, signInUrl } from '../hub/core';
import { HUB } from '../hub/useHub';

/** Shows `children(session)` only to a signed-in browser (an admin one when `admin`), a plain note otherwise. */
export function HubGate({ admin, what, children }: { admin?: boolean; what: string; children: (s: HubSession) => ReactNode }) {
  const s = useHubSession();
  if (s.phase === 'loading') return <p className="fx-muted">Checking your hub session…</p>;
  if (s.phase === 'error') {
    return (
      <Note tone="danger" icon="alert">
        <div className="fx-stack">
          <span>{s.error}</span>
          <div className="fx-row fx-row--wrap">
            <Button size="sm" icon="refresh" onClick={s.refresh}>Try again</Button>
            {s.error === OLD_HUB && <Button size="sm" icon="external" onClick={() => { location.href = `${HUB}/auth/admin/approvals`; }}>The hub's approvals page</Button>}
          </div>
        </div>
      </Note>
    );
  }
  const session = s.session;
  if (!session.signedIn) {
    return (
      <Note tone="warning" icon="shield">
        <div className="fx-stack">
          <span>Sign in on the hub to see {what}.</span>
          <div className="fx-row"><Button tone="primary" size="sm" icon="shield" onClick={() => { location.href = signInUrl(HUB, location.href); }}>Sign in</Button></div>
        </div>
      </Note>
    );
  }
  if (session.mustChangePassword) {
    return (
      <Note tone="warning" icon="key">
        <div className="fx-stack">
          <span>Pick your own password first. Nothing on the hub opens until you do.</span>
          <div className="fx-row"><Button tone="primary" size="sm" icon="key" onClick={() => { location.href = session.firstUrl ?? `${HUB}/auth/first`; }}>Pick a password</Button></div>
        </div>
      </Note>
    );
  }
  if (admin && !session.admin) return <Note tone="warning" icon="shield">{what[0]?.toUpperCase()}{what.slice(1)} need an admin account. Ask an admin for access.</Note>;
  return <>{children(session)}</>;
}

export interface Loaded<T> {
  data: T | null;
  /** What to show: at once before the first answer; over data already on screen only after a second failed read in a row. */
  error: string;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/**
 * Loads `path` (null = nothing to load), again on `reload()`, and every `everyMs` while the tab is visible.
 * Only the first read (or a new address) starts empty; every later read updates the data in place, and an answer equal to
 * the one on screen keeps the old value, so a poll during a countdown re-renders nothing (Brett, Nov 1 2026).
 */
export function useHubJson<T>(path: string | null, everyMs = 0): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [misses, setMisses] = useState(0);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await hubGet<T>(path);
      if (n === seq.current) { setData((old) => (old !== null && sameJson(old, d) ? old : d)); setError(''); setMisses(0); }
    } catch (e) {
      if (n === seq.current) { setError(e instanceof Error ? e.message : String(e)); setMisses((m) => m + 1); }
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  // A new address starts empty; a new pace (fast while something counts down) keeps what is shown.
  useEffect(() => { setData(null); setError(''); setMisses(0); void reload(); }, [reload]);
  useEffect(() => {
    if (!everyMs) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, everyMs);
    return () => clearInterval(t);
  }, [reload, everyMs]);
  return { data, error: shownError(data !== null, error, misses), loading, reload, setData };
}

/** Copies `text`, says so in a toast. */
export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const rt = useRuntime();
  return (
    <Button size={size} icon="copy" onClick={async () => {
      try { await navigator.clipboard.writeText(text); rt.toast('Copied.', 'success'); }
      catch { rt.toast("Couldn't reach the clipboard. Select the text and copy it.", 'warning'); }
    }}>{label}</Button>
  );
}

/** A button that needs a second tap within 4 s (approve everything, delete an account …). */
export function TapTwice({ label, again, onConfirm, tone = 'neutral', icon, size, disabled }: {
  label: string; again: string; onConfirm: () => void; tone?: 'primary' | 'neutral' | 'danger' | 'success' | 'ghost' | 'quiet'; icon?: string; size?: 'sm' | 'md'; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button tone={armed ? 'danger' : tone} icon={icon} size={size} disabled={disabled} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? again : label}
    </Button>
  );
}

/** Date and time in the browser's own words. */
export const when = (iso: string | number | undefined) => {
  const t = typeof iso === 'number' ? iso : Date.parse(iso ?? '');
  return Number.isFinite(t) && t > 0 ? new Date(t).toLocaleString() : '—';
};
