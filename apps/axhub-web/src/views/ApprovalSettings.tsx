/**
 * Approval settings (axHub approval-settings@1, decision 119; Brett, Nov 16 2026: "We need to stop this 90 second
 * thing. Put the veto thing on zero seconds or 10 seconds."). One hub-wide document: the veto countdown (0-120 s,
 * default 10) and whether read-only calls skip it. The same values are reachable without this page: REST
 * `GET/PUT /auth/api/approvals/settings`, MCP `axhub.settings_get` / `axhub.settings_set`, CLI
 * `axhub approvals veto-seconds <n>`, voice "set the veto countdown to ten seconds". Deep link
 * `#/approvals/settings?field=vetoSeconds` rings the field.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Container, Note, Slider, Switch, TextField, useRuntime } from '../axf/react';
import { hubPost } from '../hub/api';
import { relTime } from '../hub/core';
import { useRouteParams } from '../hub/route';
import { HubGate, useHubJson } from './hubPage';

export interface ApprovalSettingsView {
  settings: { schemaVersion: 1; vetoSeconds: number; vetoWarningSeconds: number; readOnlySkipsVeto: boolean; updatedAt?: string; updatedBy?: string };
  defaults: { vetoSeconds: number; vetoWarningSeconds: number; readOnlySkipsVeto: boolean };
  limits: { min: number; max: number };
  stored: boolean;
}

/** Fields a deep link may ring. */
export const SETTINGS_FIELDS = ['vetoSeconds', 'vetoWarningSeconds', 'readOnlySkipsVeto'] as const;

/** A whole number of seconds from `min` to `max`, or null when the text isn't one. */
export function parseSeconds(text: string, min = 0, max = 120): number | null {
  if (!/^\s*\d{1,3}\s*$/.test(text)) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

export function ApprovalSettings() {
  return <HubGate admin what="the approval settings">{() => <Page />}</HubGate>;
}

function Page() {
  const rt = useRuntime();
  const params = useRouteParams('approval-settings');
  const res = useHubJson<ApprovalSettingsView>('/auth/api/approvals/settings', 0);
  const v = res.data;
  const [seconds, setSeconds] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ring = useRef<HTMLDivElement>(null);
  const picked = (SETTINGS_FIELDS as readonly string[]).includes(params.field ?? '') ? params.field : '';

  useEffect(() => {
    if (!v) return;
    setSeconds(v.settings.vetoSeconds);
    setText(String(v.settings.vetoSeconds));
  }, [v]);
  useEffect(() => {
    if (picked && v) ring.current?.scrollIntoView({ block: 'center' });
  }, [picked, v]);

  const save = async (patch: Partial<ApprovalSettingsView['settings']>, done: string) => {
    setBusy(true);
    try {
      res.setData(await hubPost<ApprovalSettingsView>('/auth/api/approvals/settings', patch));
      rt.toast(done, 'success');
    } catch (e) {
      rt.toast(e instanceof Error ? e.message : String(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const typed = parseSeconds(text, v?.limits.min, v?.limits.max);
  const changed = v && seconds !== null && seconds !== v.settings.vetoSeconds;

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Approvals</p>
          <h1>Approval settings</h1>
          <p className="fx-muted">How long you have to deny a veto call before axHub runs it, for the whole hub.</p>
        </div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {v && seconds !== null && (
        <>
          <Container title="Veto countdown" icon="clock" actions={<Chip tone={v.settings.vetoSeconds === 0 ? 'warning' : undefined}>{v.settings.vetoSeconds === 0 ? 'Runs at once' : `${v.settings.vetoSeconds} s`}</Chip>}>
            <div className="fx-stack">
              <div ref={ring} data-axf-anchor="approval-settings-veto-seconds" className={`axp-axhub-setting${picked === 'vetoSeconds' ? ' is-picked' : ''}`}>
                <Slider label="Veto countdown (seconds)" value={seconds} min={v.limits.min} max={v.limits.max} step={1} unit=" s" onChange={(n) => { setSeconds(n); setText(String(n)); }} />
                <TextField
                  label="Seconds (0-120)"
                  type="number"
                  value={text}
                  onChange={(t) => { setText(t); const n = parseSeconds(t, v.limits.min, v.limits.max); if (n !== null) setSeconds(n); }}
                  error={typed === null ? `A whole number from ${v.limits.min} to ${v.limits.max}.` : undefined}
                  hint={seconds === 0 ? 'Zero: veto calls run at once. They are still logged and you can still see them.' : `Default ${v.defaults.vetoSeconds} s. A tool's own countdown still wins.`}
                />
              </div>
              <div className="fx-row fx-row--wrap">
                <Button tone="primary" icon="check" disabled={busy || !changed || typed === null} onClick={() => void save({ vetoSeconds: seconds }, seconds === 0 ? 'Veto calls now run at once.' : `Veto countdown set to ${seconds} s.`)}>Save</Button>
                {[0, 10, 30].map((n) => (
                  <Button key={n} size="sm" disabled={busy || v.settings.vetoSeconds === n} onClick={() => void save({ vetoSeconds: n }, n === 0 ? 'Veto calls now run at once.' : `Veto countdown set to ${n} s.`)}>{n} s</Button>
                ))}
              </div>
              <p className="fx-muted">
                {v.stored ? `Last changed ${v.settings.updatedAt ? relTime(v.settings.updatedAt) : ''}${v.settings.updatedBy ? ` by ${v.settings.updatedBy}` : ''}.` : 'Not saved yet: the hub uses the defaults.'}
              </p>
            </div>
          </Container>
          <Container title="Read-only calls" icon="eye">
            <div data-axf-anchor="approval-settings-read-only" className={`axp-axhub-setting${picked === 'readOnlySkipsVeto' ? ' is-picked' : ''}`}>
              <Switch
                label="Read-only calls run at once"
                checked={v.settings.readOnlySkipsVeto}
                disabled={busy}
                hint="Reads (ls, cat, grep, git log, docker ps …) skip the countdown and are logged as read-only. Anything that changes something keeps it."
                onChange={(on) => void save({ readOnlySkipsVeto: on }, on ? 'Read-only calls run at once.' : 'Read-only calls wait on the countdown too.')}
              />
            </div>
          </Container>
        </>
      )}
    </div>
  );
}
