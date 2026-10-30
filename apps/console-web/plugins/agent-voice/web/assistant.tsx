/**
 * Agent voice in the Assistant window (s6): the microphone (slot `assistant.mic`) and the live light + speech controls
 * (slot `assistant.head`). The assistant renders its own stand-in mic when this plugin isn't there (it then says so,
 * with install links); this is the real one.
 *
 * Tapping the mic checks, in order (core.micGate): an agent is selected → it's a voice agent → it has the Listen
 * permission → the device allows the microphone → nobody else holds the mic lease. Any "no" opens a small popover
 * naming the agent and what's missing, with a one-tap fix. A "yes" stops the agent talking (barge-in) and listens.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, IconButton, usePortalRoot, useRuntime } from '@console/axf/react';
import { micGate, type MicGate } from './core';
import { pauseSpeaking, resumeSpeaking, stopSpeaking } from './engine';
import { devicePermission, micActive, startMic, stopMic } from './mic';
import { micLease } from './lease';
import { toComposer } from './bridge';
import { LiveLight, useSpeaker } from './console';
import { loadVoice, patchProfile, profileOf, useVoiceData } from './store';

export const VIEW = 'agent-voice';
export const openAgentVoice = (rt: ReturnType<typeof useRuntime>, agentId?: string) => rt.dispatch(agentId ? `agent-voice.configure:${encodeURIComponent(agentId)}` : 'agent-voice.open');

interface SlotProps { agentId?: string; agentName?: string; compact?: boolean }

export function AssistantMic({ agentId = '', agentName = '' }: SlotProps) {
  const rt = useRuntime();
  const portal = usePortalRoot();
  const d = useVoiceData();
  const s = useSpeaker();
  const [pop, setPop] = useState<MicGate | null>(null);
  const [err, setErr] = useState('');
  const [holder, setHolder] = useState<string | null>(micLease().holder());
  const wrap = useRef<HTMLSpanElement>(null);
  const said = useRef('');
  useEffect(() => { void loadVoice(); }, []);
  useEffect(() => micLease().on(setHolder), []);
  // "Talk to <agent>" and conversation mode ask the mic to listen for this agent.
  const beginRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<{ agentId?: string }>).detail?.agentId; if (!id || id === agentId) void beginRef.current(); };
    window.addEventListener('axf:agent-voice.listen', on);
    return () => window.removeEventListener('axf:agent-voice.listen', on);
  }, [agentId]);
  useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => { const t = e.target as Element; if (!wrap.current?.contains(t) && !t.closest?.('.axp-agent-voice__pop')) setPop(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pop]);

  const popStyle = usePopPlacement(wrap, !!pop || !!err);
  const profile = profileOf(agentId);
  const mic = d.store.mic;
  const listening = s.listening && micActive();
  const name = agentName || agentId;

  const begin = async () => {
    setErr('');
    if (listening) { stopMic(); return; }
    const gate = micGate({ installed: true, agent: agentId ? { id: agentId, name } : null, profile, deviceDenied: (await devicePermission()) === 'denied', holder, speaking: s.speaking, mic });
    if (!gate.ok) { setPop(gate); return; }
    setPop(null);
    said.current = '';
    const autoSend = profile?.permissions.autoSend !== false;
    await startMic(mic, {
      partial: (t) => toComposer(`${said.current}${said.current ? ' ' : ''}${t}`, { partial: true }),
      heard: (h) => {
        if (h.kind === 'cancel') { said.current = ''; toComposer('', { partial: true }); return; }
        said.current = `${said.current}${said.current && h.text ? ' ' : ''}${h.text}`.trim();
        const send = h.kind === 'send' || (autoSend && mic.mode !== 'toggle');
        toComposer(said.current, { send, partial: false });
        if (send) said.current = '';
      },
      end: (why) => {
        if (why === 'busy') { const who = micLease().holder(); setPop(micGate({ installed: true, agent: { id: agentId, name }, profile, deviceDenied: false, holder: who ?? 'another listener', speaking: false, mic })); }
        else if (mic.mode === 'toggle' && said.current && autoSend) { toComposer(said.current, { send: true }); said.current = ''; }
      },
      error: (m) => setErr(m),
    });
  };

  beginRef.current = async () => { if (!micActive()) await begin(); };

  const fix = (g: Extract<MicGate, { ok: false }>) => {
    if (g.fix === 'enable') patchProfile(agentId, (p) => ({ ...p, enabled: true, permissions: { ...p.permissions, listen: true } }), true);
    else if (g.fix === 'allow-listen') patchProfile(agentId, (p) => ({ ...p, permissions: { ...p.permissions, listen: true } }), true);
    setPop(null);
  };

  const holdProps = mic.mode === 'hold'
    ? { onPointerDown: (e: RPointerEvent) => { e.preventDefault(); void begin(); }, onPointerUp: () => stopMic(), onPointerLeave: () => { if (micActive()) stopMic(); } }
    : { onClick: () => void begin() };
  const missing = !agentId || !profile?.enabled || !profile.permissions.listen;
  const label = listening ? 'Stop listening' : missing ? `Microphone (${name || 'no agent'}: not allowed yet)` : `Talk to ${name}`;

  return (
    <span ref={wrap} className={`axp-agent-voice__micwrap${listening ? ' is-listening' : ''}`}>
      <button type="button" className={`fx-iconbtn axp-agent-voice__mic${listening ? ' is-listening' : ''}${missing ? ' is-missing' : ''}`} aria-pressed={listening} aria-label={label} title={label} {...holdProps}>
        <Icon name="mic" size={16} />
      </button>
      {(pop && !pop.ok) && createPortal(
        <span className="axp-agent-voice__pop" role="tooltip" style={popStyle}>
          <span className="axp-agent-voice__popmsg"><Icon name={pop.reason === 'busy' ? 'clock' : 'shield'} size={13} /> {pop.message}</span>
          <span className="axp-agent-voice__popbtns">
            {pop.fix === 'enable' && <Button size="sm" tone="primary" icon="check" onClick={() => fix(pop)}>Make {name} a voice agent + allow Listen</Button>}
            {pop.fix === 'allow-listen' && <Button size="sm" tone="primary" icon="check" onClick={() => fix(pop)}>Allow {name} to listen</Button>}
            {agentId && <Button size="sm" icon="sliders" onClick={() => { setPop(null); openAgentVoice(rt, agentId); }}>{name}'s voice settings</Button>}
            {pop.reason === 'no-agent' && <span className="fx-small fx-muted">Use the agent picker in this title bar.</span>}
            <IconButton icon="x" label="Close" onClick={() => setPop(null)} />
          </span>
        </span>, portal,
      )}
      {err && !pop && createPortal(<span className="axp-agent-voice__pop" role="alert" style={popStyle}><span className="axp-agent-voice__popmsg"><Icon name="alert" size={13} /> {err}</span><IconButton icon="x" label="Close" onClick={() => setErr('')} /></span>, portal)}
    </span>
  );
}

/**
 * Where the popover goes: fixed to the viewport just above the mic, kept inside the screen (a chat dialog clips
 * anything absolutely positioned, and on a phone the mic sits too close to an edge for a fixed side).
 */
export function usePopPlacement(anchor: RefObject<HTMLElement | null>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open || !anchor.current) { setStyle(undefined); return; }
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const width = Math.min(340, vw - 16);
      const left = Math.max(8, Math.min(r.right - width, vw - width - 8));
      setStyle({ position: 'fixed', left, width, bottom: window.innerHeight - r.top + 8, right: 'auto' });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor]);
  return style;
}

/** Title-bar bits: the live light and, while speaking, pause / resume / stop. */
export function AssistantHead({ agentId = '', agentName = '' }: SlotProps) {
  const rt = useRuntime();
  const s = useSpeaker();
  const p = profileOf(agentId);
  if (!p?.enabled && !s.speaking) return null;
  return (
    <span className="axp-agent-voice__head">
      <button type="button" className="fx-iconbtn axp-agent-voice__lightbtn" onClick={() => openAgentVoice(rt, s.speaking ? s.agentId : agentId)} title={`${agentName || agentId}'s voice settings`}>
        <LiveLight size={9} agentName={agentName} />
      </button>
      {s.speaking && !s.paused && <IconButton icon="pause" label="Pause speaking" onClick={pauseSpeaking} />}
      {s.paused && <IconButton icon="play" label="Resume speaking" onClick={resumeSpeaking} />}
      {s.speaking && <IconButton icon="x" label="Stop speaking" onClick={stopSpeaking} />}
    </span>
  );
}

/** Under each finished reply (slot `assistant.reply`): say this one out loud. */
export function ReplySpeak({ agentId = '', agentName = '', text = '' }: SlotProps & { text?: string }) {
  const p = profileOf(agentId);
  if (!p?.enabled || !p.permissions.speak || !text) return null;
  return <IconButton icon="play" label={`Say it (${agentName || agentId})`} onClick={() => window.dispatchEvent(new CustomEvent('axf:agent-voice.say', { detail: { agentId, agentName, text } }))} />;
}
