/**
 * The AmberX Terminal: one tab per held command (veto@1). When a timer starts a tab opens with the title, the command,
 * a live countdown and Deny; at zero it shows the command running and its output lines from the hub's job stream; the tab
 * stays with how it ended (ran / failed / denied / expired) until closed.
 *
 * The console's Terminal plugin (`apps/console-web/plugins/console-terminal`) is a shell on the console's server (PTY over
 * its own API), so it can't run in AmberX: the command here runs on the hub (Vinnie), and AmberX only shows it. Built from
 * the framework's tabs (`fx-tabs`/`fx-tab`), terminal rows (`fx-terminal__*`), Button and Chip; layout CSS only.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Icon, Note } from '../../../axf/react';
import { formatCountdown, VETO_ACTION_LABELS, VETO_WARNING_SECONDS, type VetoAction } from '../../../axf/libs/hub/veto';
import { checkVeto, closeTrack, isFinal, startVeto, type Track, type TrackState } from './store';
import { actOn, useVeto } from './deny';
import './terminal.css';

let wanted: string | null = null;
const listeners = new Set<(id: string) => void>();
/** Bring a tab to the front (approvals.terminal:<id>). */
export function showTab(id: string | null) { wanted = id; if (id) listeners.forEach((f) => f(id)); }

const TONE: Record<TrackState, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  held: 'warning', shelved: 'warning', running: 'accent', ran: 'success', failed: 'danger', denied: undefined, expired: undefined, gone: undefined,
};
export const label = (t: Track): string => (t.call.shelved && t.state === 'held' ? 'shelved' : t.state === 'held' ? (t.left > 0 ? formatCountdown(t.left) : 'running…') : t.state === 'gone' ? 'left the hold' : t.state);

const ACTS: { a: VetoAction; icon: string; tone: 'danger' | 'primary' | 'neutral' }[] = [
  { a: 'deny', icon: 'x-circle', tone: 'danger' }, { a: 'approve-now', icon: 'play', tone: 'primary' }, { a: 'shelve', icon: 'pause', tone: 'neutral' },
];

function TrackView({ t }: { t: Track }) {
  const [busy, setBusy] = useState<VetoAction | null>(null);
  const shelved = t.state === 'held' && t.call.shelved;
  const held = t.state === 'held' && (t.left > 0 || shelved);
  const urgent = held && !shelved && t.left <= VETO_WARNING_SECONDS;
  return (
    <div className="axp-veto-track">
      <div className="axp-veto-head">
        <div className="axp-veto-what">
          <strong className="axp-veto-title">{t.call.title}</strong>
          <code className="axp-veto-cmd">$ {t.call.command || t.call.tool}</code>
        </div>
        <div className="axp-veto-side">
          {held && !shelved
            ? <span className={`axp-veto-count${urgent ? ' is-urgent' : ''}`} role="timer" aria-live={urgent ? 'assertive' : 'off'}>{formatCountdown(t.left)}</span>
            : <Chip tone={shelved ? 'warning' : TONE[t.state]}>{label(t)}{t.exitCode !== null ? ` · exit ${t.exitCode}` : ''}</Chip>}
          {held && ACTS.filter((x) => t.call.actions.includes(x.a)).map((x) => (
            <Button key={x.a} tone={x.tone} icon={x.icon} busy={busy === x.a} disabled={busy !== null} onClick={() => { setBusy(x.a); void actOn(t, x.a).finally(() => setBusy(null)); }}>{VETO_ACTION_LABELS[x.a]}</Button>
          ))}
          <Button icon="external" onClick={() => window.open(t.call.url, '_blank', 'noopener,noreferrer')}>On the hub</Button>
        </div>
      </div>
      {held && <p className="fx-small fx-muted axp-veto-note">{shelved ? 'Shelved: the countdown is paused until you approve or deny it.' : 'Runs on the VPS when the countdown ends. Deny stops it, Approve runs it now, Shelve pauses the countdown.'}</p>}
      <div className="fx-terminal axp-veto-term" role="log" aria-label={`Output of ${t.call.title}`}>
        <div className="fx-terminal__lines">
          {t.lines.map((l, i) => (
            <div key={i} className={`fx-terminal__row${l.stream === 'stderr' ? ' is-error' : l.stream === 'note' ? ' is-note' : ''}`}>
              <span className="fx-terminal__time">{new Date(l.at).toLocaleTimeString()}</span>
              <span className="fx-terminal__text">{l.text}</span>
            </div>
          ))}
          {t.streaming && !isFinal(t.state) && <div className="fx-terminal__row is-note"><span className="fx-terminal__text">{t.state === 'held' ? 'Waiting for the countdown…' : 'Running…'}</span></div>}
        </div>
      </div>
    </div>
  );
}

export function TerminalView() {
  const s = useVeto();
  useEffect(() => { startVeto(); }, []);
  const [active, setActive] = useState<string | null>(wanted);
  useEffect(() => { const f = (id: string) => setActive(id); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const tracks = useMemo(() => [...s.tracks].sort((a, b) => b.startedAt - a.startedAt), [s.tracks]);
  const current = tracks.find((t) => t.call.id === active) ?? tracks[0] ?? null;
  return (
    <div className="fx-stack fx-stack--lg axp-veto">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Terminal · held commands</p>
          <h1>{tracks.some((t) => t.state === 'held') ? `${tracks.filter((t) => t.state === 'held').length} held` : 'Terminal'}</h1>
          <p className="fx-muted">Each command Claude sends through Vinnie opens a tab here: the countdown, Deny / Approve / Shelve, then the output when the hub runs it.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void checkVeto()}>Check now</Button>
        </div>
      </header>
      {s.status === 'signed-out' && <Note tone="warning">Signed out of axHub: sign in so AmberX can see held commands.</Note>}
      {s.status === 'unreachable' && <Note tone="warning">Can't reach axHub right now.</Note>}
      {!tracks.length ? <p className="fx-muted">No held commands yet. When one starts its timer, a tab opens here.</p> : (
        <>
          <div className="fx-tabs axp-veto-tabs" role="tablist" aria-label="Held commands">
            {tracks.map((t) => (
              <button key={t.call.id} type="button" role="tab" aria-selected={current?.call.id === t.call.id} className="fx-tab" onClick={() => setActive(t.call.id)}>
                <Icon name={t.state === 'held' ? 'clock' : t.state === 'ran' ? 'check-circle' : t.state === 'failed' ? 'x-circle' : 'terminal'} size={14} />
                <span className="axp-veto-tabname">{t.call.title}</span>
                <span className="fx-small fx-muted">{label(t)}</span>
                {isFinal(t.state) && (
                  <span role="button" tabIndex={0} className="fx-tab__close" aria-label={`Close ${t.call.title}`}
                    onClick={(e) => { e.stopPropagation(); closeTrack(t.call.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); closeTrack(t.call.id); } }}>
                    <Icon name="x" size={12} />
                  </span>
                )}
              </button>
            ))}
          </div>
          {current && <TrackView t={current} />}
        </>
      )}
    </div>
  );
}
