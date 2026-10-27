/**
 * The console is a developer app (Brett's decision, Oct 20 2026): its look and settings come from axHub's data server
 * (`shared/settings/appearance.json`, framework `HubAppearanceSource`), it waits for the hub instead of running
 * without it, and every change made here (Settings → Appearance, the theme manager, a roll) is saved there, so every
 * other developer app (Build Pilot, the AXHub phone app, the Android console, axHub's own pages) follows it live.
 *
 * The hub's address comes from the console server (`GET /api/me` → `hub`, the same AXF_WALL_HUB the wall uses), so a
 * local dev console against a local hub works too; until the server answers, the default hub is used.
 */
import { useEffect, useState } from 'react';
import { Chip, HubAppearanceSource, DEFAULT_HUB, useAxfState, useRuntime } from './axf/react';
import type { AxfWebLibrary } from './axf/react/library';
import manifest from '../axf.manifest.json';

let attachedHub = '';

/** The hub this console reads its look from (what App tabs or plugins may hand to other apps). */
export const hubOrigin = () => attachedHub || DEFAULT_HUB;

/** The hub to read the look from (`appearanceHub`, else the wall's hub); `off` = no source (local dev without a hub). */
async function hubFromServer(): Promise<string> {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return DEFAULT_HUB;
    const j = (await r.json()) as { hub?: string; appearanceHub?: string };
    const pick = String(j.appearanceHub ?? j.hub ?? DEFAULT_HUB);
    return pick === 'off' ? 'off' : new URL(pick).origin;
  } catch {
    return DEFAULT_HUB;
  }
}

/** Attach the hub appearance source once the hub's address is known (re-attaches only if the address changes). */
export function useHubAppearance(): void {
  const rt = useRuntime();
  useEffect(() => {
    let cancelled = false;
    void hubFromServer().then((hub) => {
      if (cancelled || attachedHub === hub) return;
      attachedHub = hub;
      if (hub === 'off') { rt.terminal.warn('appearance', 'AXF_APPEARANCE_HUB=off: no hub source, local settings only (development)'); rt.detachAppearanceSource(); return; }
      try {
        rt.attachAppearanceSource(new HubAppearanceSource({ hub, appId: manifest.app.id }));
      } catch (e) {
        rt.terminal.error('appearance', `hub address refused: ${(e as Error).message}`);
      }
    });
    return () => { cancelled = true; };
  }, [rt]);
}

/** Settings → Appearance → Look from axHub: where the look lives, its state, and ids this app doesn't have. */
function HubLookPanel() {
  const rt = useRuntime();
  const state = useAxfState();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);
  const st = state.appearance;
  const skipped = rt.appearanceSkipped();
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>
        Every choice on this page is saved to axHub (<span className="fx-mono">{hubOrigin()}</span>, document <span className="fx-mono">shared/settings/appearance.json</span>)
        and every developer app follows it live: this console, Build Pilot, the AXHub phone app, the Android console and axHub's own pages.
        A change made in any of them shows up here too.
      </p>
      <div className="fx-row fx-row--wrap">
        {!st && <Chip>no hub source</Chip>}
        {st?.status === 'ready' && <Chip tone="success">connected{st.version ? ` · version ${st.version}` : ' · nothing saved yet'}</Chip>}
        {st?.status === 'connecting' && <Chip>connecting…</Chip>}
        {st?.status === 'unauthorized' && <Chip tone="warning">{st.reason}</Chip>}
        {st?.status === 'unreachable' && <Chip tone="danger">unreachable · {st.reason}</Chip>}
      </div>
      <p className="fx-muted">Design packages: Settings → Appearance → AmberX Design Package.</p>
      {skipped.length > 0 && (
        <p className="fx-small fx-muted" style={{ margin: 0 }}>
          Saved on the hub but not in this app (that slot keeps this app's default): {skipped.join(', ')}.
        </p>
      )}
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        Who may change it: your hub account's role here (admins, or users granted <span className="fx-mono">console.themes</span>) and, on the hub, admins or users with <span className="fx-mono">data.write</span>.
        If the hub is down this console waits for it; the way back in is the VPS shell (see framework/spec/APPEARANCE-SOURCE.md).
      </p>
    </div>
  );
}


export const hubAppearanceLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.hub-appearance',
  label: 'Look from axHub',
  version: '1.0.0',
  settingsPanels: [
    { id: 'console.appearance.hub', tab: 'appearance', title: 'Look from axHub', icon: 'layers', order: 5, render: () => <HubLookPanel /> },
  ],
};
