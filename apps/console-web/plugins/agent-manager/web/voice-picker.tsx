/*
 * Voice picker for an agent's or persona's voice slot ({provider, voiceId, hint, rate, pitch}, agent-definition@1):
 * provider (device voice, OpenAI, ElevenLabs), the provider's voice list, speed and pitch, Match from the hint
 * ("cat-like", "calm": server/voices.py picks the voice and sets speed and pitch) and Preview. The same slot drives the
 * group chat audio (agent-swarm folds it under the room's own per-agent override). REST: GET voices,
 * POST voices/catalogue, POST voices/match, PUT voice/{agents|personas}/{id}.
 */
import { useEffect, useState } from 'react';
import { Button, SelectField, Slider } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { call, post, type Voice } from './api';
import { Field, Text } from './forms';

export interface VoiceProvider { id: string; label: string; about: string }
export interface CatalogueVoice { id: string; name: string; traits: string[]; lang?: string }
export interface VoiceMatch { provider: string; voiceId: string; name: string; rate: number; pitch: number; score: number; why: string; traits: string[] }

type NativeTts = {
  speak(o: { text: string; lang?: string; rate: number; pitch: number; volume: number; voice?: string; id: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  ttsVoices?(): Promise<{ voices: { id?: string; name: string; lang: string }[] }>;
};
const native = (): NativeTts | null => {
  const c = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { AmberxNative?: NativeTts } } }).Capacitor;
  return c?.isNativePlatform?.() && c.Plugins?.AmberxNative?.speak ? c.Plugins.AmberxNative : null;
};
const synth = (): SpeechSynthesis | null => (typeof globalThis.speechSynthesis === 'object' ? globalThis.speechSynthesis : null);

/** This device's voices: the phone's TTS in AmberX, else the browser's speechSynthesis (loads late in Chrome). */
export async function deviceVoices(): Promise<{ id: string; name: string; lang: string }[]> {
  const n = native();
  if (n?.ttsVoices) {
    try { return ((await n.ttsVoices()).voices ?? []).map((v) => ({ id: v.id ?? v.name, name: v.name, lang: v.lang })); } catch { return []; }
  }
  const s = synth(); if (!s) return [];
  const read = () => s.getVoices().map((v) => ({ id: v.name, name: v.name, lang: v.lang }));
  if (read().length) return read();
  await new Promise<void>((res) => { const t = setTimeout(res, 1200); s.addEventListener?.('voiceschanged', () => { clearTimeout(t); res(); }, { once: true }); });
  return read();
}

/** Cloud voice lists and previews go through Agent voice (its keys); without it, previews play on this device. */
const VOICE_PLUGIN = 'agent-voice'; // axf-plugin:agent-voice

/** A provider's raw voice list: device voices here, OpenAI's from this plugin, ElevenLabs' through Agent voice (its key). */
export async function providerVoices(provider: string): Promise<{ id: string; name: string; lang?: string }[]> {
  if (provider === 'browser') return deviceVoices();
  if (provider === 'openai') return (await call<{ openai: CatalogueVoice[] }>('voices')).openai;
  const r = await pluginFetch(VOICE_PLUGIN, `voices/${provider}`);
  const j = await r.json().catch(() => ({})) as { voices?: { id: string; name: string; category?: string }[]; detail?: string };
  if (!r.ok) throw new Error(j.detail ?? `the ${provider} voices could not be listed (is Agent voice installed with a key?)`);
  return (j.voices ?? []).map((v) => ({ id: v.id, name: v.name, description: v.category ?? '' }));
}

/** Best voice + speed + pitch for a hint (server/voices.py). */
export const matchVoice = (hint: string, provider: string, voices?: unknown[]) =>
  post<{ match: VoiceMatch }>('voices/match', { hint, provider, voices }).then((r) => r.match);

let previewN = 0;
/** Say a line in a slot's voice: cloud voices through Agent voice (/tts, agents allowed cloud voices), else on this device. */
export async function previewVoice(slot: Voice, text: string, agentId?: string): Promise<string> {
  const rate = slot.rate ?? 1; const pitch = slot.pitch ?? 1;
  if (slot.provider && slot.provider !== 'browser' && agentId) {
    const r = await pluginFetch(VOICE_PLUGIN, 'tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId, text, provider: slot.provider, voice: slot.voiceId, rate }) });
    if (r.ok) { const url = URL.createObjectURL(await r.blob()); const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); await a.play(); return ''; }
    const j = await r.json().catch(() => ({})) as { detail?: string };
    // fall through to the device so the speed and pitch can still be heard
    const note = `Cloud preview: ${j.detail ?? r.statusText}. Playing on this device instead.`;
    await speakHere({ ...slot, voiceId: '' }, text, rate, pitch); return note;
  }
  await speakHere(slot, text, rate, pitch); return '';
}
async function speakHere(slot: Voice, text: string, rate: number, pitch: number) {
  const n = native();
  if (n) { await n.stopSpeaking().catch(() => undefined); await n.speak({ text, rate, pitch, volume: 1, id: `am-voice-${++previewN}`, ...(slot.voiceId ? { voice: slot.voiceId } : {}) }); return; }
  const s = synth(); if (!s) throw new Error('This device has no speech engine.');
  s.cancel();
  const u = new SpeechSynthesisUtterance(text); u.rate = rate; u.pitch = pitch;
  const v = slot.voiceId ? s.getVoices().find((x) => x.name === slot.voiceId) : undefined; if (v) { u.voice = v; u.lang = v.lang; }
  s.speak(u);
}

let providersCache: VoiceProvider[] | null = null;

/** The voice slot editor (agents: `voice`; personas: `voiceSlot`). */
export function VoicePicker({ value, onChange, name, agentId, target }: { value?: Voice | null; onChange: (v: Voice) => void; name?: string; agentId?: string; target: string }) {
  const v: Voice = value ?? {};
  const provider = v.provider || 'browser';
  const [providers, setProviders] = useState<VoiceProvider[]>(providersCache ?? []);
  const [list, setList] = useState<{ id: string; name: string; lang?: string }[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!providersCache) void call<{ providers: VoiceProvider[] }>('voices').then((r) => { providersCache = r.providers; setProviders(r.providers); }).catch(() => undefined); }, []);
  useEffect(() => {
    let live = true; setList([]); setNote('');
    providerVoices(provider).then((l) => { if (live) setList(l); }).catch((e: Error) => { if (live) setNote(e.message); });
    return () => { live = false; };
  }, [provider]);

  const set = (p: Partial<Voice>) => onChange({ ...v, ...p });
  const match = async () => {
    setBusy(true);
    try { const m = await matchVoice(v.hint ?? '', provider, list); set({ provider, voiceId: m.voiceId || v.voiceId || '', rate: m.rate, pitch: m.pitch }); setNote(m.why); }
    catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  const preview = async () => {
    try { setNote(await previewVoice({ ...v, provider }, `Hi, I'm ${name || 'your agent'}. This is how I sound in the group chat.`, agentId)); }
    catch (e) { setNote((e as Error).message); }
  };
  const pct = (n: number | undefined) => Math.round((n ?? 1) * 100);
  const about = providers.find((p) => p.id === provider)?.about;

  return (
    <div className="fx-stack axp-agent-manager__voice" data-axf-target={target}>
      <div className="axp-agent-manager__cols">
        <SelectField label="Voice from" value={provider} options={(providers.length ? providers : [{ id: 'browser', label: 'Device voice', about: '' }]).map((p) => ({ value: p.id, label: p.label }))} onChange={(p) => set({ provider: p, voiceId: '' })} />
        <SelectField label="Voice" value={v.voiceId ?? ''} empty={provider === 'browser' ? 'The device default' : 'Pick a voice'} options={list.map((x) => ({ value: x.id, label: x.lang ? `${x.name} (${x.lang})` : x.name }))} onChange={(voiceId) => set({ provider, voiceId })} />
      </div>
      <Field label="Hint" hint={about ?? 'Describe the voice; Match picks one from the list and sets speed and pitch'}>
        <Text value={v.hint} onChange={(hint) => set({ hint })} placeholder="e.g. cat-like, calm, deep british narrator" />
      </Field>
      <div className="axp-agent-manager__cols">
        <Slider label="Speed" value={pct(v.rate)} min={50} max={200} unit="%" onChange={(n) => set({ rate: n / 100 })} />
        <Slider label="Pitch" value={pct(v.pitch)} min={0} max={200} unit="%" onChange={(n) => set({ pitch: n / 100 })} />
      </div>
      <div className="fx-row" role="toolbar" aria-label="Voice actions">
        <Button size="sm" onClick={() => void match()} disabled={busy} data-axf-target={`${target}/match`}>Match from hint</Button>
        <Button size="sm" tone="ghost" onClick={() => void preview()} data-axf-target={`${target}/preview`}>Preview</Button>
        <Button size="sm" tone="ghost" onClick={() => onChange({ provider: '', voiceId: '', hint: v.hint ?? '' })} data-axf-target={`${target}/reset`}>Reset</Button>
      </div>
      {note && <span className="fx-small fx-muted" role="status">{note}</span>}
    </div>
  );
}
