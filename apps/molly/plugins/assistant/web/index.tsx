import { useEffect, useRef } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { EMBED_PAGE_QUERY, embedUrl } from '../../../src/axf/core/engines/embed';
import { Button, useRuntime } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { mollyApp } from '../../../src/molly/apps';
import helpPack from '../help.json';
import './assistant.css';

/*
 * AI assistant (Molly plugin, its own folder; build ai-assistant-in-molly-console-drives-by-api-open, Nov 10 2026).
 * Brett: "Give Molly and the AI assistant access to the API so she can drive the console, open screens and configure
 * settings. Easy to reach, hands free."
 *
 * One plugin, one chat: Molly frames the Dev Console's own AI assistant page (the console plugin's view `ai-assistant`
 * as an embed@1 view page, every chrome hidden) as a Molly view and as a floating window, so everything the console's
 * assistant has (every provider, the console control API, hands-free voice, approvals) is Molly's too, with no second
 * implementation. Molly owns it: every console frame on the page is told `owned` (protocol `ai-assistant-host@1`, a
 * postMessage between the two plugins, neither imports the other), and from then on "Ask the assistant" anywhere in the
 * console asks Molly, which opens this window. Removed, the console draws its own dialog inside its frame again.
 */

export const PLUGIN_ID = 'ai.amberx.axf.molly.assistant';
const FOLDER = 'assistant';
const TAB = 'molly-assistant';
export const VIEW = 'assistant';
export const DIALOG = 'molly-assistant.chat';
/** The app whose assistant this is (an app id from molly/apps.ts). */
const SOURCE = 'console';
const HOST_MESSAGE = 'ai-assistant-host@1';
/** How often every console frame is reminded that Molly owns the assistant (frames reload; a reminder costs nothing). */
const OWN_EVERY_MS = 4_000;

const consoleApp = () => mollyApp(SOURCE);
const consoleOrigin = (): string => { const a = consoleApp(); return a ? new URL(a.url).origin : ''; };

/** The console's assistant page, framed by Molly: the embed@1 marker plus the view page (all chrome hidden). */
export function assistantPageUrl(): string {
  const a = consoleApp();
  if (!a) return '';
  return embedUrl(`${a.url}/?${EMBED_PAGE_QUERY}=view:ai-assistant#/ai-assistant`, 'molly');
}

interface HostStart { agentId?: string; message: string; title?: string; profileId?: string; model?: string }
/** What a console frame asked to open (also the dialog's props, hence the open shape). */
interface OpenPayload { start?: HostStart; note?: string; [k: string]: unknown }

/* ---------- the frame (view and floating window share it) ---------- */

/** The one assistant frame on the page right now (so a chat handed over goes to the copy that is open). */
let frame: HTMLIFrameElement | null = null;
let pending: OpenPayload | null = null;

function toFrame(m: Record<string, unknown>): boolean {
  if (!frame?.contentWindow) return false;
  frame.contentWindow.postMessage({ $axf: HOST_MESSAGE, ...m }, consoleOrigin());
  return true;
}

function AssistantFrame({ compact = false, start }: { compact?: boolean; start?: OpenPayload }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const src = assistantPageUrl();
  useEffect(() => {
    frame = ref.current;
    if (start?.start || start?.note) pending = start;
    const el = ref.current;
    const onLoad = () => { if (pending) { toFrame({ type: 'start', ...pending }); pending = null; } };
    el?.addEventListener('load', onLoad);
    return () => { el?.removeEventListener('load', onLoad); if (frame === el) frame = null; };
  }, [start]);
  if (!src) return <p className="fx-muted">Molly has no Console app to show the assistant from.</p>;
  return (
    <iframe ref={ref} title="AI assistant" className={`molly-assistant__frame${compact ? ' is-compact' : ''}`} src={src} data-help="molly-assistant-frame"
      allow="microphone; autoplay; screen-wake-lock; clipboard-read; clipboard-write" />
  );
}

function AssistantView() {
  return (
    <div className="fx-stack molly-assistant">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Molly · AI</p><h1>AI assistant</h1><p className="fx-muted">The console's assistant, owned by Molly: it drives the console, changes settings and listens hands-free.</p></div></header>
      <AssistantFrame />
    </div>
  );
}

/* ---------- owning the console's assistant ---------- */

/** Tell every console frame that Molly owns the assistant (or not, when this plugin stops). */
function tellOwned(on: boolean): void {
  const origin = consoleOrigin();
  if (!origin) return;
  for (const f of document.querySelectorAll<HTMLIFrameElement>(`iframe.molly-frame[data-app="${SOURCE}"]`)) {
    if (f === frame) continue; // the assistant page itself is the owned copy
    f.contentWindow?.postMessage({ $axf: HOST_MESSAGE, type: 'owned', on }, origin);
  }
}

/** A console frame asked to open the assistant: open Molly's window with what it was asked to start. */
function openFromConsole(rt: AxfRuntime, payload: OpenPayload): void {
  if (frame && (payload.start || payload.note)) { toFrame({ type: 'start', ...payload }); if (rt.getState().view !== VIEW && !rt.getState().dialog) rt.openDialog(DIALOG, payload); return; }
  if (rt.getState().view === VIEW) { pending = payload.start || payload.note ? payload : null; if (pending && frame) { toFrame({ type: 'start', ...pending }); pending = null; } return; }
  rt.openDialog(DIALOG, payload);
}

/* ---------- settings tab ---------- */

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p className="fx-muted">The Dev Console's assistant runs inside Molly as one chat. Providers, behaviour, the Console tool group and hands-free voice are set in the console (Settings → Plugins → AI assistant there); the assistant can open that page for you.</p>
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Open the assistant">
        <Button tone="primary" icon="sparkles" data-help="molly-assistant-open" onClick={() => rt.openDialog(DIALOG)}>Open in a window</Button>
        <Button icon="external" onClick={() => rt.navigate(VIEW)}>Open as a page</Button>
        <Button icon="mic" data-help="molly-assistant-hands-free" onClick={() => rt.dispatch('molly-assistant.hands-free')}>Hands-free voice on / off</Button>
      </div>
    </div>
  );
}

function LifecyclePanel() {
  return (
    <div className="fx-stack">
      <p className="fx-muted">This plugin's code is all in apps/molly/plugins/{FOLDER}. Install or remove it (removed, the console draws its own assistant dialog inside its frame again):</p>
      <pre className="molly-assistant__code">{`node apps/molly/plugins/${FOLDER}/install.mjs\nnode apps/molly/plugins/${FOLDER}/uninstall.mjs --all`}</pre>
    </div>
  );
}

/* ---------- the library ---------- */

let started = false;

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'AI assistant',
  version: '0.1.0',
  provides: ['view:assistant', 'dialog:molly-assistant.chat', 'action:molly-assistant.open', 'action:molly-assistant.page', 'action:molly-assistant.hands-free', 'settings-tab:molly-assistant'],
  builtWith: { model: 'fable', builtAt: '2026-11-10' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    if (started) return; // StrictMode runs this twice in development
    started = true;
    rt.actions.register('molly-assistant.open', ([prompt]) => rt.openDialog(DIALOG, prompt ? { note: prompt } : {}), { label: 'Ask the AI assistant…' });
    rt.actions.register('molly-assistant.page', () => rt.navigate(VIEW), { label: 'AI assistant page' });
    // Hands-free voice: flips the console plugin's server switch through the open assistant frame (opening one when none is up).
    rt.actions.register('molly-assistant.hands-free', ([how]) => {
      const m = how === 'on' ? { type: 'hands-free', on: true } : how === 'off' ? { type: 'hands-free', on: false } : { type: 'hands-free', toggle: true };
      if (toFrame(m)) return;
      rt.openDialog(DIALOG, {});
      const t = setInterval(() => { if (toFrame(m)) clearInterval(t); }, 500);
      setTimeout(() => clearInterval(t), 15_000);
    }, { label: 'Hands-free voice on / off', params: true });
    // Own the assistant in every console frame, and open it here when a frame asks.
    const origin = consoleOrigin();
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || !e.data || typeof e.data !== 'object') return;
      const d = e.data as { $axf?: string; type?: string; start?: HostStart; note?: string };
      if (d.$axf !== HOST_MESSAGE || d.type !== 'open') return;
      const from = [...document.querySelectorAll<HTMLIFrameElement>('iframe')].find((f) => f.contentWindow === e.source);
      if (!from || from === frame) return; // only the console frames Molly shows, never the assistant page itself
      openFromConsole(rt, { ...(d.start && typeof d.start.message === 'string' ? { start: d.start } : {}), ...(typeof d.note === 'string' ? { note: d.note } : {}) });
    };
    window.addEventListener('message', onMessage);
    tellOwned(true);
    setInterval(() => tellOwned(true), OWN_EVERY_MS);
    window.addEventListener('pagehide', () => tellOwned(false));
  },
  views: { [VIEW]: { title: 'AI assistant', icon: 'sparkles', render: () => <AssistantView /> } },
  dialogs: {
    [DIALOG]: {
      title: 'AI assistant',
      icon: 'sparkles',
      render: (props) => <div className="molly-assistant__dialog"><AssistantFrame compact start={props as OpenPayload} /></div>,
    },
  },
  nav: { label: 'Molly', items: [{ id: 'molly-assistant', label: 'AI assistant', icon: 'sparkles', view: VIEW }] },
  settingsTabs: [{ id: TAB, label: 'AI assistant', icon: 'sparkles', order: 20, parent: 'plugins', description: 'The console’s assistant inside Molly: open it, hands-free voice; its settings live in the console.' }],
  settingsPanels: [
    { id: 'molly-assistant.open', tab: TAB, title: 'Open the assistant', icon: 'sparkles', order: 10, render: () => <OpenPanel /> },
    { id: 'molly-assistant.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
  appMenu: [
    { id: 'molly-assistant.menu', menu: 'molly', menuLabel: 'Molly', menuOrder: 10, order: 5, items: [
      { id: 'molly-assistant.ask', label: 'Ask the AI assistant…', icon: 'sparkles', action: 'molly-assistant.open' },
      { id: 'molly-assistant.page', label: 'AI assistant page', icon: 'external', action: 'molly-assistant.page' },
      { id: 'molly-assistant.hands-free', label: 'Hands-free voice on / off', icon: 'mic', action: 'molly-assistant.hands-free' },
    ] },
  ],
};
