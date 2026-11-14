import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, SelectField, Slider, Switch, TabGroup, useRuntime } from '@console/axf/react';
import * as A from '../../../../../framework/core/engines/chat-audio.mjs';
import type { AudioSettings, Mode } from '../../../../../framework/core/engines/chat-audio.mjs';
import * as player from './chat-audio';
import type { Act, Agent } from './ui-types';

/*
 * Group chat audio controls, on top of the room (console and AmberX alike): Enable audio, this device, volume, the
 * mode (everything / only my mentions / summaries only), the voice cast, play controls and who is read aloud.
 * Every change is the `audio` action (swarm.mjs audioAct), the same one the CLI, MCP and voice send.
 */

export type AudioState = { settings: AudioSettings; casts: { id: string; name: string; description?: string }[]; cast: string; text: string };

export function usePlayer() { return useSyncExternalStore(player.subscribe, player.status, player.status); }

export function ChatAudioBar({ audio, agents, act }: { audio: AudioState | undefined; agents: Agent[]; act: Act }) {
  const rt = useRuntime();
  const p = usePlayer();
  const s = A.normSettings(audio?.settings);
  const [vol, setVol] = useState(s.volume);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const sig = JSON.stringify(s);
  useEffect(() => { setVol(s.volume); player.applySettings(s); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (change: Record<string, unknown>) => act({ action: 'audio', ...change });
  const moveVol = (v: number) => { setVol(v); clearTimeout(timer.current); timer.current = setTimeout(() => void set({ volume: v }), 400); };
  const device = p.device;
  const who = p.speaking ? `Speaking: ${p.speaking.name}` : s.enabled && device ? 'Listening for new messages' : '';
  return (
    <section className="fx-stack sw-audio" aria-label="Group chat audio">
      <div className="sw-bar">
        <Switch label="Enable audio" checked={s.enabled} onChange={(v) => void set({ enabled: v })} hint={s.enabled ? A.describe(s, Object.fromEntries(agents.map((a) => [a.id, a.name]))) : 'Hear the crew: new messages are read aloud, one voice at a time.'} />
        <Switch label="This device" checked={device} onChange={(v) => rt.settings.set(player.AUDIO_KEYS.device, v)} disabled={!s.enabled} hint={p.engine === 'none' ? 'No speech engine here.' : p.engine === 'native' ? 'Phone voice: keeps talking with the screen off.' : 'Browser voice.'} />
      </div>
      {s.enabled && (
        <>
          <div className="sw-bar">
            <div className="sw-slider"><Slider label="Volume" value={vol} min={0} max={100} unit="%" onChange={moveVol} /></div>
            <TabGroup id="agent-swarm.audio-mode" label="Read" size="sm" value={s.mode} onChange={(v: Mode) => void set({ mode: v })} tabs={A.MODES.map((m) => ({ value: m, label: A.MODE_LABELS[m] }))} />
            <SelectField className="sw-bar__pick" label="Voices" value={s.cast} empty="From the skin" options={(audio?.casts ?? []).map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => void set({ cast: v || 'skin' })} />
          </div>
          <div className="sw-bar" role="toolbar" aria-label="Playback">
            {p.paused ? <Button size="sm" icon="play" onClick={() => player.resume()}>Resume</Button> : <Button size="sm" icon="pause" disabled={!p.speaking && !p.waiting} onClick={() => player.pause()}>Pause</Button>}
            <Button size="sm" icon="arrow-right" disabled={!p.speaking} onClick={() => player.skip()}>Skip</Button>
            <Button size="sm" icon="x" disabled={!p.speaking && !p.waiting} onClick={() => player.stop()}>Stop</Button>
            <span className="fx-muted" aria-live="polite">{who}{p.waiting ? ` · ${p.waiting} waiting` : ''}{p.dropped ? ` · ${p.dropped} skipped (queue full)` : ''}{p.error ? ` · ${p.error}` : ''}</span>
          </div>
          <div className="sw-bar" role="group" aria-label="Who is read aloud">
            {agents.map((a) => <Switch key={a.id} label={a.name} checked={!s.muted[a.id]} onChange={(v) => void set(v ? { unmute: a.id } : { mute: a.id })} />)}
            <Button size="sm" onClick={() => void set({ unmute: 'all' })}>Unmute all</Button>
          </div>
        </>
      )}
    </section>
  );
}

/** Per-agent voice: try it, tune speed and pitch, back to the cast's. For the agent's profile. */
export function AgentVoice({ a, audio, act }: { a: Agent; audio: AudioState | undefined; act: Act }) {
  const s = A.normSettings(audio?.settings);
  const v = player.voiceOf(a.id);
  const o = s.voices[a.id] ?? {};
  const [tune, setTune] = useState({ rate: Math.round(v.rate * 100), pitch: Math.round(v.pitch * 100) });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setTune({ rate: Math.round(v.rate * 100), pitch: Math.round(v.pitch * 100) }); }, [v.rate, v.pitch]);
  // sliders save a moment after they stop moving
  const save = (k: 'rate' | 'pitch', n: number) => { setTune((t) => ({ ...t, [k]: n })); clearTimeout(timer.current); timer.current = setTimeout(() => void act({ action: 'audio', agent: a.id, voice: { [k]: n / 100 } }), 450); };
  return (
    <div className="fx-stack">
      <div className="sw-bar">
        <Button size="sm" icon="play" onClick={() => player.sample(a.id)}>Try {a.name}'s voice</Button>
        {Object.keys(o).length > 0 && <Button size="sm" onClick={() => void act({ action: 'audio', agent: a.id, voice: null })}>Use the cast's voice</Button>}
      </div>
      <div className="sw-slider"><Slider label="Speed" value={tune.rate} min={50} max={200} unit="%" onChange={(n) => save('rate', n)} /></div>
      <div className="sw-slider"><Slider label="Pitch" value={tune.pitch} min={0} max={200} unit="%" onChange={(n) => save('pitch', n)} /></div>
      <p className="fx-muted">{v.label || 'Voice'} · {v.gender === 'any' ? 'any voice' : v.gender} · {v.lang}</p>
    </div>
  );
}
