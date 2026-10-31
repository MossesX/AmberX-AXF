/**
 * Agent voice — the per-agent configuration console (s5): every agent from the agent manager on the left, the selected
 * agent's voice on the right in tabs (Voice · Narrator · Permissions · Pronunciation · Try it). Changes save as you go.
 * Plus the settings panels (Settings → Plugins → Agent voice): microphone, cloud voices, global pronunciations.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, Container, Icon, IconButton, Note, Segmented, SelectField, Slider, Switch, TextField, useRuntime } from '@console/axf/react';
import {
  applyPreset, AUTO_SPEAK, CODE_MODES, DEFAULT_MIC, EMOJI_MODES, estimateMs, exportProfiles, INTERRUPT, LIGHT_LABEL, MIC_MODES, narrate, NUMBER_MODES, PRESETS,
  READ_MODES, URL_MODES, type MicSettings, type Narrator, type Pronunciation, type VoiceProfile,
} from './core';
import { deviceVoices, isAmberX, onSpeaker, pauseSpeaking, resumeSpeaking, skipLine, speak, speakerState, stopSpeaking, type DeviceVoice } from './engine';
import {
  agentName, clearCache, cloudVoices, deleteKey, getKeys, importVoice, putKey, loadVoice, patchProfile, profileOrDefault, removeProfile, saveMic, savePronunciations,
  useVoiceData, type KeyInfo,
} from './store';
import { useLight } from './light';

export const useSpeaker = () => useSyncExternalStore(onSpeaker, speakerState, speakerState);

const SAMPLE = `# Good morning

Here's where things stand. The **AmberX** build passed and two steps are left:

1. Merge the PR on GitHub
2. Install the new APK from axHub

See [the build log](https://github.com/MossesX/AmberX-AXF/actions) for details. That's everything for now.`;

const opts = <T extends string>(all: readonly T[], labels: Partial<Record<T, string>> = {}) => all.map((v) => ({ value: v, label: labels[v] ?? v[0]!.toUpperCase() + v.slice(1).replace(/-/g, ' ') }));
const pct = (v: number) => Math.round(v * 100);

/* ---------------------------------------------------------------- page */

type Tab = 'voice' | 'narrator' | 'permissions' | 'pronunciation' | 'try';

export function AgentVoiceConsole({ initialAgent }: { initialAgent?: string }) {
  const d = useVoiceData();
  const rt = useRuntime();
  const [sel, setSel] = useState(initialAgent ?? '');
  const [tab, setTab] = useState<Tab>('voice');
  const [q, setQ] = useState('');
  useEffect(() => { void loadVoice(); }, []);
  useEffect(() => { if (!sel && d.agents.length) setSel(d.agents[0]!.id); }, [d.agents, sel]);
  useEffect(() => { if (initialAgent) setSel(initialAgent); }, [initialAgent]);
  const agents = d.agents.filter((a) => !q.trim() || `${a.name} ${a.id}`.toLowerCase().includes(q.trim().toLowerCase()));
  const p = profileOrDefault(sel);
  const name = agentName(sel);

  return (
    <div className="fx-stack fx-stack--lg axp-agent-voice">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugins · voice</p>
          <h1 className="axp-agent-voice__h1"><LiveLight size={14} /> Agent voice</h1>
          <p className="fx-muted">Give each agent a voice, a narrator style and permission to listen. Changes save as you go{d.saving ? ' (saving…)' : ''}.</p>
        </div>
        <div className="axp-agent-voice__headbtns">
          <Button size="sm" icon="mic" onClick={() => rt.dispatch('settings.open:agent-voice')}>Microphone settings</Button>
          <Button size="sm" icon="refresh" onClick={() => void loadVoice(true)}>Reload</Button>
        </div>
      </header>
      {d.error && <Note tone="danger">{d.error}</Note>}
      {d.loaded && !d.agentsService && <Note tone="warning">No agent manager is installed or switched on, so there are no agents to give a voice to. Install the Agent manager plugin, then come back.</Note>}
      <div className="axp-agent-voice__split">
        <aside className="axp-agent-voice__agents" aria-label="Agents">
          <TextField label="Find an agent" value={q} onChange={setQ} placeholder="Name or id" />
          <div className="axp-agent-voice__list" role="listbox" aria-label="Agents">
            {agents.map((a) => {
              const ap = d.store.profiles[a.id];
              return (
                <button key={a.id} type="button" role="option" aria-selected={a.id === sel} className={`fx-btn axp-agent-voice__agent${a.id === sel ? ' is-on' : ''}`} onClick={() => setSel(a.id)}>
                  <Icon name={a.icon || 'user'} size={14} />
                  <span className="axp-agent-voice__agentname">{a.name}</span>
                  {ap?.enabled ? <Chip tone="success">voice</Chip> : <span className="fx-small fx-muted">off</span>}
                  {ap?.enabled && ap.permissions.listen && <Icon name="mic" size={12} />}
                </button>
              );
            })}
            {d.loaded && !agents.length && <p className="fx-small fx-muted">No agents{q ? ' match' : ''}.</p>}
          </div>
        </aside>
        {sel ? (
          <section className="fx-stack axp-agent-voice__detail">
            <Container title={<span className="axp-agent-voice__title"><Icon name="user" size={14} /> {name}</span>} icon="sliders"
              actions={<AgentActions agentId={sel} />}>
              <Switch label={`${name} is a voice agent`} checked={p.enabled} onChange={(v) => patchProfile(sel, (x) => ({ ...x, enabled: v }), true)}
                hint="Voice agents speak their replies and light the live status light when they're the selected agent." />
              <Segmented<Tab> label="Section" value={tab} onChange={setTab} options={[
                { value: 'voice', label: 'Voice', icon: 'sliders' }, { value: 'narrator', label: 'Narrator', icon: 'list' },
                { value: 'permissions', label: 'Permissions', icon: 'shield' }, { value: 'pronunciation', label: 'Pronunciation', icon: 'edit' },
                { value: 'try', label: 'Try it', icon: 'play' },
              ]} />
            </Container>
            {tab === 'voice' && <VoiceTab p={p} />}
            {tab === 'narrator' && <NarratorTab p={p} />}
            {tab === 'permissions' && <PermissionsTab p={p} name={name} />}
            {tab === 'pronunciation' && <PronunciationTab p={p} />}
            {tab === 'try' && <TryTab p={p} name={name} />}
          </section>
        ) : <Note>Pick an agent.</Note>}
      </div>
    </div>
  );
}

function AgentActions({ agentId }: { agentId: string }) {
  const d = useVoiceData();
  const [from, setFrom] = useState('');
  const others = d.agents.filter((a) => a.id !== agentId && d.store.profiles[a.id]);
  return (
    <span className="axp-agent-voice__actions">
      {others.length > 0 && (
        <select className="fx-input fx-input--sm" aria-label="Copy the voice of" value={from} onChange={(e) => {
          const src = d.store.profiles[e.target.value];
          if (src) patchProfile(agentId, () => ({ ...src, agentId, permissions: { ...src.permissions } }), true);
          setFrom('');
        }}>
          <option value="">Copy from…</option>
          {others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      <IconButton icon="refresh" label="Reset to defaults" onClick={() => { if (confirm(`Reset ${agentName(agentId)}'s voice to the defaults?`)) void removeProfile(agentId); }} />
    </span>
  );
}

/* ---------------------------------------------------------------- tabs */

const up = (p: VoiceProfile, patch: Partial<VoiceProfile>) => patchProfile(p.agentId, (x) => ({ ...x, ...patch }));
const upN = (p: VoiceProfile, patch: Partial<Narrator>) => patchProfile(p.agentId, (x) => ({ ...x, narrator: { ...x.narrator, ...patch } }));

function VoiceTab({ p }: { p: VoiceProfile }) {
  const d = useVoiceData();
  const [voices, setVoices] = useState<DeviceVoice[]>([]);
  const [cloud, setCloud] = useState<{ voices: { id: string; name: string }[]; models: string[]; error: string }>({ voices: [], models: [], error: '' });
  useEffect(() => { void deviceVoices().then(setVoices); }, []);
  useEffect(() => {
    if (p.engine !== 'cloud') return;
    setCloud((c) => ({ ...c, error: '' }));
    cloudVoices(p.cloud.provider).then((r) => setCloud({ voices: r.voices, models: r.models, error: '' }), (e: Error) => setCloud({ voices: [], models: [], error: e.message }));
  }, [p.engine, p.cloud.provider, d.cloud.elevenlabs]);
  const langs = useMemo(() => [...new Set(voices.map((v) => v.lang).filter(Boolean))].sort(), [voices]);
  const forLang = voices.filter((v) => !p.device.lang || v.lang.toLowerCase().startsWith(p.device.lang.slice(0, 2).toLowerCase()));
  const cloudReady = d.cloud[p.cloud.provider];
  return (
    <>
      <Container title="Presets" icon="zap">
        <div className="axp-agent-voice__chips">
          {PRESETS.map((pr) => <Button key={pr.id} size="sm" title={pr.hint} onClick={() => patchProfile(p.agentId, (x) => applyPreset(x, pr.id), true)}>{pr.label}</Button>)}
        </div>
        <p className="fx-small fx-muted">A preset sets speed, pitch, volume and the narrator rules in one tap; adjust anything after.</p>
      </Container>
      <Container title="Engine" icon="cloud">
        <Segmented label="Engine" value={p.engine} onChange={(v) => up(p, { engine: v })} options={[
          { value: 'device', label: isAmberX() ? 'Phone voice' : 'Device voice', icon: 'smartphone', title: 'Free, offline, instant' },
          { value: 'cloud', label: 'Cloud voice', icon: 'cloud', title: 'Most natural; OpenAI or ElevenLabs key on the server' },
        ]} />
        {p.engine === 'cloud' && !p.permissions.cloud && <Note tone="warning">Cloud voices are off in this agent's Permissions, so it speaks with the device voice until you allow them.</Note>}
        <Switch label="Fall back to the device voice when the cloud voice fails" checked={p.fallback} onChange={(v) => up(p, { fallback: v })} />
      </Container>
      {p.engine === 'device' ? (
        <Container title="Device voice" icon="smartphone">
          <SelectField label="Language" value={p.device.lang} options={(langs.length ? langs : ['en-US', 'en-GB', 'en-AU', 'es-ES', 'fr-FR', 'de-DE']).map((l) => ({ value: l, label: l }))} onChange={(v) => up(p, { device: { ...p.device, lang: v, voice: '' } })} />
          <SelectField label="Voice" value={p.device.voice} empty="The device's default voice" options={forLang.map((v) => ({ value: v.id, label: `${v.name}${v.local ? '' : ' (online)'}` }))} onChange={(v) => up(p, { device: { ...p.device, voice: v } })}
            hint={voices.length ? `${forLang.length} voices for this language on this device. Another device lists its own.` : 'This device didn\'t list its voices; the default voice is used.'} />
        </Container>
      ) : (
        <Container title="Cloud voice" icon="cloud">
          <Segmented label="Provider" value={p.cloud.provider} onChange={(v) => up(p, { cloud: { ...p.cloud, provider: v, voice: v === 'openai' ? 'alloy' : '', model: '' } })} options={[{ value: 'openai', label: 'OpenAI' }, { value: 'elevenlabs', label: 'ElevenLabs' }]} />
          {!cloudReady && <Note tone="warning">No {p.cloud.provider === 'openai' ? 'OpenAI' : 'ElevenLabs'} key on the server yet. Add it under Settings → Plugins → Agent voice → Cloud voices.</Note>}
          {cloud.error && <Note tone="danger">{cloud.error}</Note>}
          <SelectField label="Voice" value={p.cloud.voice} options={cloud.voices.map((v) => ({ value: v.id, label: v.name }))} empty={cloud.voices.length ? undefined : 'No voices listed'} onChange={(v) => up(p, { cloud: { ...p.cloud, voice: v } })} />
          <SelectField label="Model" value={p.cloud.model} options={cloud.models.map((m) => ({ value: m, label: m }))} onChange={(v) => up(p, { cloud: { ...p.cloud, model: v } })} />
          {p.cloud.provider === 'openai'
            ? <TextField label="Speaking style" rows={2} value={p.cloud.style} onChange={(v) => up(p, { cloud: { ...p.cloud, style: v } })} placeholder="Warm and calm, like a radio host. Slight smile." hint="Only gpt-4o-mini-tts follows a style." />
            : <>
              <Slider label="Stability" value={pct(p.cloud.stability)} min={0} max={100} unit="%" onChange={(v) => up(p, { cloud: { ...p.cloud, stability: v / 100 } })} />
              <Slider label="Similarity" value={pct(p.cloud.similarity)} min={0} max={100} unit="%" onChange={(v) => up(p, { cloud: { ...p.cloud, similarity: v / 100 } })} />
            </>}
        </Container>
      )}
      <Container title="Delivery" icon="sliders">
        <Slider label="Speed" value={pct(p.rate)} min={50} max={200} step={5} unit="%" onChange={(v) => up(p, { rate: v / 100 })} />
        <Slider label="Pitch" value={pct(p.pitch)} min={50} max={200} step={5} unit="%" onChange={(v) => up(p, { pitch: v / 100 })} />
        <Slider label="Volume" value={pct(p.volume)} min={0} max={100} step={5} unit="%" onChange={(v) => up(p, { volume: v / 100 })} />
        <SelectField label="Speak replies" value={p.autoSpeak} options={opts(AUTO_SPEAK, { off: 'Only when I tap Speak', replies: 'Every reply, out loud', 'voice-only': 'Only replies to things I said by voice' })} onChange={(v) => up(p, { autoSpeak: v as VoiceProfile['autoSpeak'] })} />
        <SelectField label="When a new reply comes while talking" value={p.interrupt} options={opts(INTERRUPT, { 'barge-in': 'Stop and say the new one', queue: 'Finish, then say the new one', replace: 'Drop the rest, say the new one' })} onChange={(v) => up(p, { interrupt: v as VoiceProfile['interrupt'] })} />
        <Switch label="Conversation mode" checked={p.conversation} onChange={(v) => up(p, { conversation: v })} hint="After the agent finishes speaking, the microphone opens again so you can answer hands-free (needs the Listen permission)." />
      </Container>
    </>
  );
}

function NarratorTab({ p }: { p: VoiceProfile }) {
  const n = p.narrator;
  return (
    <>
      <Container title="What gets read" icon="list">
        <SelectField label="Read" value={n.readMode} options={opts(READ_MODES, { full: 'The whole reply', summary: 'The first few sentences', first: 'Only the first sentence' })} onChange={(v) => upN(p, { readMode: v as Narrator['readMode'] })} />
        {n.readMode === 'summary' && <Slider label="Sentences" value={n.sentences} min={1} max={12} onChange={(v) => upN(p, { sentences: v })} />}
        <Slider label="Longest reply read out" value={n.maxChars} min={200} max={8000} step={100} unit=" chars" onChange={(v) => upN(p, { maxChars: v })} />
        <SelectField label="Code" value={n.code} options={opts(CODE_MODES, { skip: 'Skip it', mention: 'Say there is code', read: 'Read it line by line' })} onChange={(v) => upN(p, { code: v as Narrator['code'] })} />
        <SelectField label="Links" value={n.urls} options={opts(URL_MODES, { domain: 'Say the site (example.com)', mention: 'Say "a link"', skip: 'Skip them', read: 'Read the whole address' })} onChange={(v) => upN(p, { urls: v as Narrator['urls'] })} />
        <SelectField label="Long numbers" value={n.numbers} options={opts(NUMBER_MODES, { natural: 'As numbers (one thousand twenty)', digits: 'Digit by digit (one zero two zero)' })} onChange={(v) => upN(p, { numbers: v as Narrator['numbers'] })} />
        <SelectField label="Emoji" value={n.emoji} options={opts(EMOJI_MODES, { skip: 'Skip them', keep: 'Let the voice read them' })} onChange={(v) => upN(p, { emoji: v as Narrator['emoji'] })} />
        <Switch label="Announce headings" checked={n.headings} onChange={(v) => upN(p, { headings: v })} />
        <Switch label="Number list items out loud" checked={n.numberLists} onChange={(v) => upN(p, { numberLists: v })} />
        <Switch label="Slow down a little on bold text and headings" checked={n.emphasis} onChange={(v) => upN(p, { emphasis: v })} />
      </Container>
      <Container title="Pacing" icon="clock">
        <Slider label="Pause after a sentence" value={n.sentencePause} min={0} max={2000} step={50} unit=" ms" onChange={(v) => upN(p, { sentencePause: v })} />
        <Slider label="Pause after a paragraph" value={n.paragraphPause} min={0} max={3000} step={50} unit=" ms" onChange={(v) => upN(p, { paragraphPause: v })} />
        <Slider label="Pause after a list item" value={n.listPause} min={0} max={2000} step={50} unit=" ms" onChange={(v) => upN(p, { listPause: v })} />
      </Container>
      <Container title="Signature" icon="star">
        <TextField label="Intro" value={n.intro} onChange={(v) => upN(p, { intro: v })} placeholder="{name} here." hint="Said before every reply. {name} = the agent's name. Empty = nothing." />
        <TextField label="Outro" value={n.outro} onChange={(v) => upN(p, { outro: v })} placeholder="Anything else?" />
        <Switch label="Chime before speaking" checked={n.chime} onChange={(v) => upN(p, { chime: v })} />
      </Container>
    </>
  );
}

function PermissionsTab({ p, name }: { p: VoiceProfile; name: string }) {
  const perm = (k: keyof VoiceProfile['permissions'], v: boolean) => patchProfile(p.agentId, (x) => ({ ...x, permissions: { ...x.permissions, [k]: v } }), true);
  return (
    <Container title={`What ${name} may do`} icon="shield">
      {!p.enabled && <Note tone="warning">{name} isn't a voice agent yet: switch it on above first.</Note>}
      <Switch label="Speak out loud" checked={p.permissions.speak} onChange={(v) => perm('speak', v)} />
      <Switch label="Listen (the Assistant microphone)" checked={p.permissions.listen} onChange={(v) => perm('listen', v)} hint={`Without it the Assistant microphone says "${name} is missing permission".`} />
      <Switch label="Send what I say right away" checked={p.permissions.autoSend} onChange={(v) => perm('autoSend', v)} hint="Off: what you said waits in the box until you press Send (or say the send phrase)." />
      <Switch label={`"Talk to ${name}" voice command`} checked={p.permissions.wakeName} onChange={(v) => perm('wakeName', v)} hint="Adds an action you (and AmberX voice commands) can use to open the Assistant on this agent and start listening." />
      <Switch label="Cloud voices" checked={p.permissions.cloud} onChange={(v) => perm('cloud', v)} hint="Lets the reply text go to the cloud voice provider. The server refuses cloud speech without it." />
    </Container>
  );
}

function PronunciationEditor({ list, onChange }: { list: Pronunciation[]; onChange: (l: Pronunciation[]) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const add = () => { if (!from.trim()) return; onChange([...list.filter((x) => x.from.toLowerCase() !== from.trim().toLowerCase()), { from: from.trim(), to, whole: true, caseSensitive: false }]); setFrom(''); setTo(''); };
  return (
    <div className="fx-stack">
      <div className="axp-agent-voice__pronadd">
        <TextField label="Written" value={from} onChange={setFrom} placeholder="k8s" />
        <TextField label="Said" value={to} onChange={setTo} placeholder="kubernetes" />
        <Button icon="plus" onClick={add} disabled={!from.trim()}>Add</Button>
      </div>
      {list.map((x, i) => (
        <div key={`${x.from}-${i}`} className="axp-agent-voice__pronrow">
          <span className="fx-mono">{x.from}</span><Icon name="arrow-right" size={12} /><span>{x.to || <em className="fx-muted">(silent)</em>}</span>
          <Switch label="Whole word" checked={x.whole} onChange={(v) => onChange(list.map((y, j) => (j === i ? { ...y, whole: v } : y)))} text="whole word" hideLabel />
          <Switch label="Match case" checked={x.caseSensitive} onChange={(v) => onChange(list.map((y, j) => (j === i ? { ...y, caseSensitive: v } : y)))} text="case" hideLabel />
          <IconButton icon="trash" label={`Remove ${x.from}`} onClick={() => onChange(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      {!list.length && <p className="fx-small fx-muted">None yet.</p>}
    </div>
  );
}

function PronunciationTab({ p }: { p: VoiceProfile }) {
  return (
    <Container title="This agent's pronunciations" icon="edit">
      <p className="fx-small fx-muted">These win over the global list (Settings → Plugins → Agent voice) and the built-in ones (AmberX, AXF, axHub, VPS…).</p>
      <PronunciationEditor list={p.pronunciations} onChange={(l) => patchProfile(p.agentId, (x) => ({ ...x, pronunciations: l }))} />
    </Container>
  );
}

function TryTab({ p, name }: { p: VoiceProfile; name: string }) {
  const d = useVoiceData();
  const s = useSpeaker();
  const [text, setText] = useState(SAMPLE);
  const chunks = useMemo(() => narrate(text, p, { agentName: name, global: d.store.pronunciations }), [text, p, name, d.store.pronunciations]);
  const say = () => speak({ profile: { ...p, enabled: true, permissions: { ...p.permissions, speak: true } }, agentName: name, text, global: d.store.pronunciations });
  return (
    <>
      <Container title="Try it" icon="play">
        <TextField label="Text" rows={7} value={text} onChange={setText} />
        <div className="axp-agent-voice__chips">
          <Button tone="primary" icon="play" onClick={() => void say()}>Speak</Button>
          {s.speaking && !s.paused && <Button icon="pause" onClick={pauseSpeaking}>Pause</Button>}
          {s.paused && <Button icon="play" onClick={resumeSpeaking}>Resume</Button>}
          {s.speaking && <Button icon="chevron-right" onClick={skipLine}>Skip line</Button>}
          {s.speaking && <Button tone="danger" icon="x" onClick={stopSpeaking}>Stop</Button>}
          <Button icon="refresh" onClick={() => setText(SAMPLE)}>Sample</Button>
        </div>
        {s.speaking && <p className="fx-small">Saying {s.index}/{s.total}{s.engine ? ` · ${s.engine}` : ''}: “{s.line}”</p>}
        {s.error && <Note tone="warning">{s.error}</Note>}
      </Container>
      <Container title={`What ${name} will say (${chunks.length} lines, about ${Math.max(1, Math.round(estimateMs(chunks, p.rate) / 1000))} s)`} icon="list">
        <ol className="axp-agent-voice__chunks">
          {chunks.map((c, i) => <li key={i}><span className={`axp-agent-voice__kind axp-agent-voice__kind--${c.kind}`}>{c.kind}</span> {c.text}{c.pause ? <span className="fx-small fx-muted"> · {c.pause} ms</span> : null}{c.rateMul !== 1 ? <span className="fx-small fx-muted"> · slower</span> : null}</li>)}
        </ol>
      </Container>
    </>
  );
}

/* ---------------------------------------------------------------- the live light */

export function LiveLight({ size = 10, withLabel = false, agentName: forName }: { size?: number; withLabel?: boolean; agentName?: string }) {
  const l = useLight();
  if (l.state === 'off' && !withLabel) return null;
  const title = l.state === 'off' ? 'No voice agent selected' : `${forName || l.agentName || 'Agent'} · ${LIGHT_LABEL[l.state]}${l.line ? `: “${l.line}”` : ''}`;
  return (
    <span className={`axp-agent-voice__light axp-agent-voice__light--${l.state}`} role="status" aria-label={title} title={title}>
      <span className="axp-agent-voice__dot" style={{ width: size, height: size }} />
      {withLabel && <span className="fx-small">{LIGHT_LABEL[l.state]}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- settings panels */

export function MicPanel() {
  const d = useVoiceData();
  const m = d.store.mic;
  useEffect(() => { void loadVoice(); }, []);
  const set = (patch: Partial<MicSettings>) => saveMic({ ...m, ...patch });
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">The microphone in the Assistant window. It shares the mic with AmberX's hands-free listening, dictation and Speak a command: only one listens at a time and none of them steals it from another.</p>
      <SelectField label="How it listens" value={m.mode} options={opts(MIC_MODES, { tap: 'Tap: one sentence, then stop', hold: 'Hold: listens while held', toggle: 'Toggle: keeps listening until tapped again' })} onChange={(v) => set({ mode: v as MicSettings['mode'] })} />
      <TextField label="Language" value={m.lang} onChange={(v) => set({ lang: v })} placeholder="en-US" />
      <Switch label="Show words as they're said" checked={m.liveText} onChange={(v) => set({ liveText: v })} />
      <TextField label="Send phrase" value={m.sendPhrase} onChange={(v) => set({ sendPhrase: v })} hint={'Ending with it sends at once ("…send it"). Empty = none.'} />
      <TextField label="Cancel phrase" value={m.cancelPhrase} onChange={(v) => set({ cancelPhrase: v })} hint="Saying only this throws the sentence away." />
      <Switch label='Spoken punctuation ("comma", "period", "new line")' checked={m.spokenPunctuation} onChange={(v) => set({ spokenPunctuation: v })} />
      <Slider label="Stop after silence (toggle mode)" value={m.silenceMs} min={800} max={15000} step={100} unit=" ms" onChange={(v) => set({ silenceMs: v })} />
      <Slider label="Never listen longer than" value={m.maxSeconds} min={5} max={600} step={5} unit=" s" onChange={(v) => set({ maxSeconds: v })} />
      <Switch label="Pressing the mic stops the agent talking" checked={m.bargeIn} onChange={(v) => set({ bargeIn: v })} />
      <Switch label="Hands-free listening steps aside while this listens (AmberX)" checked={m.pauseHandsFree} onChange={(v) => set({ pauseHandsFree: v })} />
      <Switch label="Hands-free can't hear the agent's voice as a command (AmberX)" checked={m.muteWakeWhileSpeaking} onChange={(v) => set({ muteWakeWhileSpeaking: v })} />
      <Switch label="Wait when dictation or Speak a command has the mic" checked={m.respectOthers} onChange={(v) => set({ respectOthers: v })} hint="Off: say it's busy at once instead of waiting." />
      {m.respectOthers && <Slider label="Wait up to" value={m.waitMs} min={0} max={15000} step={500} unit=" ms" onChange={(v) => set({ waitMs: v })} />}
      <Switch label="Vibrate when the mic opens (phone)" checked={m.haptics} onChange={(v) => set({ haptics: v })} />
      <Switch label="Keep the words in the box if sending fails" checked={m.keepOnError} onChange={(v) => set({ keepOnError: v })} />
      <Button size="sm" icon="refresh" onClick={() => saveMic({ ...DEFAULT_MIC })}>Defaults</Button>
    </div>
  );
}

export function CloudPanel() {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [input, setInput] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const load = () => getKeys().then(setKeys, (e: Error) => setMsg({ tone: 'danger', text: e.message }));
  useEffect(() => { void load(); }, []);
  const save = async (id: string) => {
    setBusy(id); setMsg(null);
    try { await putKey(id, input[id] ?? ''); setInput({ ...input, [id]: '' }); setMsg({ tone: 'success', text: 'Key tested and saved on the server.' }); await load(); }
    catch (e) { setMsg({ tone: 'danger', text: (e as Error).message }); }
    finally { setBusy(''); }
  };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Keys stay on the server (0600 files, never sent to a browser). An agent only uses a cloud voice when its Permissions allow cloud voices.</p>
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      {keys.map((k) => (
        <div key={k.id} className="axp-agent-voice__key">
          <strong>{k.id === 'openai' ? 'OpenAI' : 'ElevenLabs'}</strong>
          {k.set ? <Chip tone="success">{k.stored ? 'key saved' : `from ${k.envName}`}</Chip> : <Chip tone="warning">no key</Chip>}
          <TextField label="New key" type="password" value={input[k.id] ?? ''} onChange={(v) => setInput({ ...input, [k.id]: v })} placeholder={k.id === 'openai' ? 'sk-…' : 'xi-…'} />
          <Button size="sm" icon="check" busy={busy === k.id} disabled={!(input[k.id] ?? '').trim()} onClick={() => void save(k.id)}>Test & save</Button>
          {k.stored && <Button size="sm" tone="danger" icon="trash" onClick={() => void deleteKey(k.id).then(load)}>Remove</Button>}
        </div>
      ))}
      <Button size="sm" icon="trash" onClick={() => void clearCache().then((r) => setMsg({ tone: 'success', text: `Cleared ${r.removed} cached clips.` }))}>Clear the spoken-audio cache</Button>
    </div>
  );
}

export function GlobalPronunciationsPanel() {
  const d = useVoiceData();
  useEffect(() => { void loadVoice(); }, []);
  return <PronunciationEditor list={d.store.pronunciations} onChange={savePronunciations} />;
}

export function ImportExportPanel() {
  const d = useVoiceData();
  const [note, setNote] = useState<ReactNode>(null);
  const download = () => {
    const blob = new Blob([exportProfiles(d.store)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'agent-voices.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <div className="fx-stack">
      <div className="axp-agent-voice__chips">
        <Button size="sm" icon="download" onClick={download}>Export every voice</Button>
        <label className="fx-btn fx-btn--sm"><Icon name="upload" size={12} /> Import…<input type="file" accept="application/json" hidden onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (f) void f.text().then(importVoice).then((n) => setNote(<Note tone="success">Imported {n} voices.</Note>), (err: Error) => setNote(<Note tone="danger">{err.message}</Note>));
        }} /></label>
      </div>
      {note}
    </div>
  );
}
