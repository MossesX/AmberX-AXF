/**
 * Gizmo (console screen `gizmo`, Nov 10 2026). Gizmo lives in AmberX; this screen gives his links and opens him: here
 * (the AmberX web app in a new tab) or on Brett's phone (AmberX through axHub, `amberx.open_url`). The same works
 * without the UI: console_open "gizmo", console_action gizmo.phone / gizmo.open, REST GET|POST /api/console/gizmo,
 * CLI `node console.mjs gizmo [chat|new|talk] [--here]`, and on the phone "open gizmo" by voice.
 */
import { useEffect, useState } from 'react';
import { Button, Container, Note, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { pluginFetch } from '@console/plugins';

const FOLDER = 'console-commands';
export const GIZMO_VIEW = 'gizmo';
export type GizmoMode = 'chat' | 'new' | 'talk';
const MODES: { mode: GizmoMode; label: string; icon: string }[] = [
  { mode: 'chat', label: 'Chat', icon: 'sparkles' },
  { mode: 'new', label: 'New chat', icon: 'plus' },
  { mode: 'talk', label: 'Talk mode', icon: 'mic' },
];
/** Shown until the server answers (the server's AXF_AMBERX_PUBLIC_URL wins). */
const FALLBACK: Record<GizmoMode, string> = { chat: 'https://amberx.amberxai.com/gizmo', new: 'https://amberx.amberxai.com/gizmo/new', talk: 'https://amberx.amberxai.com/gizmo/talk' };

const modeOf = (a: unknown): GizmoMode => (a === 'new' || a === 'talk' ? a : 'chat');

async function links(): Promise<Record<GizmoMode, string>> {
  try {
    const j = (await (await pluginFetch(FOLDER, 'gizmo')).json()) as { links?: Record<GizmoMode, string> };
    return { ...FALLBACK, ...(j.links ?? {}) };
  } catch { return FALLBACK; }
}

/** Opens Gizmo in a new tab (the AmberX web app; on a phone with AmberX, Android hands the link to the app). */
export async function openGizmoHere(mode: GizmoMode = 'chat'): Promise<void> {
  window.open((await links())[mode], '_blank', 'noopener');
}

/** Asks Brett's phone to open Gizmo; toasts what the phone said. */
export async function openGizmoOnPhone(rt: AxfRuntime, mode: GizmoMode = 'chat'): Promise<boolean> {
  try {
    const r = await pluginFetch(FOLDER, 'gizmo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; phone?: { message?: string } };
    const msg = j.phone?.message || j.message || `The console answered ${r.status}.`;
    rt.toast(msg, j.ok ? 'success' : 'warning', 'Gizmo');
    return !!j.ok;
  } catch {
    rt.toast('The Console commands server part is not answering.', 'danger', 'Gizmo');
    return false;
  }
}

/** Registers gizmo.open[:mode] and gizmo.phone[:mode]. */
export function registerGizmoActions(rt: AxfRuntime): void {
  rt.actions.register('gizmo.open', (args) => { void openGizmoHere(modeOf(args[0])); }, { label: 'Open Gizmo (AmberX web app)' });
  rt.actions.register('gizmo.phone', (args) => { void openGizmoOnPhone(rt, modeOf(args[0])); }, { label: 'Open Gizmo on my phone' });
}

export function GizmoPage() {
  const rt = useRuntime();
  const [urls, setUrls] = useState<Record<GizmoMode, string>>(FALLBACK);
  const [busy, setBusy] = useState<GizmoMode | null>(null);
  useEffect(() => { let alive = true; void links().then((l) => { if (alive) setUrls(l); }); return () => { alive = false; }; }, []);
  const phone = async (mode: GizmoMode) => { setBusy(mode); try { await openGizmoOnPhone(rt, mode); } finally { setBusy(null); } };
  return (
    <div className="axp-gizmo" data-help="view:gizmo">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AmberX</p>
          <h1>Gizmo</h1>
          <p className="fx-muted">Open Gizmo in AmberX: on your phone, or in the AmberX web app here.</p>
        </div>
      </header>
      <Container title="Open Gizmo" icon="sparkles">
        <div className="axp-gizmo__rows">
          {MODES.map(({ mode, label, icon }) => (
            <div key={mode} className="axp-gizmo__row" data-mode={mode}>
              <strong>{label}</strong>
              <code className="axp-gizmo__url">{urls[mode]}</code>
              <div className="axp-gizmo__actions" role="toolbar" aria-label={`Open Gizmo: ${label}`}>
                <Button size="sm" icon="smartphone" disabled={busy !== null} onClick={() => void phone(mode)}>{busy === mode ? 'Asking the phone…' : 'On my phone'}</Button>
                <Button size="sm" icon={icon} onClick={() => void openGizmoHere(mode)}>Here</Button>
              </div>
            </div>
          ))}
        </div>
      </Container>
      <Note tone="info">
        The links open the AmberX app when it is installed (Android app link), else the AmberX web app. Without this page: <code>console_action gizmo.phone</code> (MCP), <code>POST /api/console/gizmo</code> with <code>{'{"mode": "talk"}'}</code>, <code>axf console gizmo talk</code>, or say "open gizmo" to AmberX.
      </Note>
    </div>
  );
}
