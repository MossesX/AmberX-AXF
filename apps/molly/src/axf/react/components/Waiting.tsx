/**
 * Waiting screen for developer apps (runtime `attachAppearanceSource`): shown instead of the app while the axHub data
 * server hasn't answered. It is themed by the app's defaults (the engines still run on the default assets), says what
 * is unreachable and why, counts down to the next try and offers Retry. There is no "run anyway": a developer app
 * doesn't run without the hub (Brett's decision, Oct 20 2026). Emergency paths stay outside the app: the console's
 * `AXF_WALL=off` reinstall and the VPS shell (framework/spec/APPEARANCE-SOURCE.md).
 */
import { useEffect, useState } from 'react';
import type { AppearanceSourceState } from '../../core';
import { useRuntime } from '../AxfProvider';
import { Button, Container } from './Controls';
import { Icon } from './Icon';

export function WaitingForHub({ state, hub }: { state: AppearanceSourceState; hub?: string }) {
  const rt = useRuntime();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const [since] = useState(() => Date.now());
  const waited = Math.round((Date.now() - since) / 1000);
  const title = state.status === 'unauthorized' ? 'Sign in to axHub' : 'Waiting for axHub';
  const detail = state.status === 'connecting' ? `Loading this app's settings from the hub…`
    : state.status === 'unauthorized' ? state.reason
    : state.status === 'unreachable' ? state.reason : '';
  return (
    <div className="fx-waiting" role="status" aria-live="polite" data-fx-waiting={state.status}>
      <Container title={title} icon={state.status === 'unauthorized' ? 'lock' : 'clock'}>
        <div className="fx-stack">
          <p style={{ margin: 0 }}>
            This app keeps its settings and its look on axHub{hub ? <> (<span className="fx-mono">{hub}</span>)</> : null}. It starts once the hub answers.
          </p>
          {detail && <p className="fx-muted" style={{ margin: 0 }}>{detail}</p>}
          {state.status === 'unreachable' && (
            <p className="fx-small fx-muted" style={{ margin: 0 }}>
              Try {state.attempt} failed · next try in {Math.max(0, Math.ceil(state.retryInMs / 1000))} s · waiting {waited} s
            </p>
          )}
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="refresh" onClick={() => rt.refreshFromSaved()}>Retry now</Button>
            {state.status === 'unauthorized' && hub && (
              <a className="fx-btn fx-btn--neutral" style={{ textDecoration: 'none' }} href={`${hub}/auth/login?rd=${encodeURIComponent(globalThis.location?.href ?? '/')}`}>
                <Icon name="external" size={14} /> Sign in on the hub
              </a>
            )}
          </div>
          <p className="fx-small fx-muted" style={{ margin: 0 }}>
            No local copy is used on purpose: every developer app follows the one shared look. If the hub itself is down, fix it from the VPS shell (see the framework's APPEARANCE-SOURCE spec).
          </p>
        </div>
      </Container>
    </div>
  );
}
