/**
 * The Assistant's stand-in microphone (Oct 29 2026, Brett): shown when no plugin fills the `assistant.mic` slot. It
 * can't listen; tapping it says that the voice plugin isn't installed and offers the ways to get it: install it (the
 * console's plugin installer, when there is one), switch it on (plugin switches), or ask the selected agent to install
 * it (a new chat with that agent). Generic: it names a capability ("Agent voice"), never another plugin's folder.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, usePortalRoot, useRuntime } from '@console/axf/react';

const INSTALLERS = [
  { action: 'plugins-menu.install', label: 'Install it' },
  { action: 'plugin-manager.install', label: 'Install from the catalog' },
];

export function VoiceMicStandIn({ agentId, agentName }: { agentId: string; agentName: string }) {
  const rt = useRuntime();
  const portal = usePortalRoot();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { const t = e.target as Element; if (!wrap.current?.contains(t) && !t.closest?.('.axp-ai-assistant__micpop')) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  // Fixed to the viewport above the mic, kept on screen (the chat dialog clips absolutely positioned popovers).
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open || !wrap.current) { setStyle(undefined); return; }
    const r = wrap.current.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    setStyle({ position: 'fixed', width, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), bottom: window.innerHeight - r.top + 8, right: 'auto' });
  }, [open]);
  const installer = INSTALLERS.find((i) => rt.actions.get(i.action));
  const switches = rt.actions.get('plugin-switches.open');
  const who = agentName || 'the assistant';
  const askAgent = () => {
    setOpen(false);
    const message = 'Install the Agent voice plugin in this app (the console plugin that lets agents speak, with the Assistant microphone and the live voice light), switch it on, and tell me when it is ready. Ask me before anything that needs my approval.';
    rt.dispatch(`ai.chat.start:${encodeURIComponent(JSON.stringify({ ...(agentId ? { agentId } : {}), message, title: 'Install Agent voice' }))}`);
  };
  return (
    <span ref={wrap} className="axp-ai-assistant__micwrap">
      <button type="button" className="fx-iconbtn axp-ai-assistant__mic is-missing" aria-label="Microphone (Agent voice isn't installed)" title="Microphone (Agent voice isn't installed)" onClick={() => setOpen((v) => !v)}>
        <Icon name="mic" size={16} />
      </button>
      {open && createPortal(
        <span className="axp-ai-assistant__micpop" role="tooltip" style={style} onMouseDown={(e) => e.stopPropagation()}>
          <span className="axp-ai-assistant__micmsg"><Icon name="package" size={13} /> Agent voice isn't installed, so {agentName || 'agents'} can't listen or speak. Install it to talk to {agentName || 'agents'} here.</span>
          <span className="axp-ai-assistant__micbtns">
            {installer && <Button size="sm" tone="primary" icon="download" onClick={() => { setOpen(false); rt.dispatch(installer.action); }}>{installer.label}</Button>}
            {switches && <Button size="sm" icon="sliders" onClick={() => { setOpen(false); rt.dispatch('plugin-switches.open'); }}>It's installed but off? Switch it on</Button>}
            <Button size="sm" icon="sparkles" onClick={askAgent}>Install it with {who}</Button>
          </span>
        </span>, portal,
      )}
    </span>
  );
}
