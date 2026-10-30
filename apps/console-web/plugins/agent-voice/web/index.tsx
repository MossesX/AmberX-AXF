import { useEffect, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Container, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { LIGHT_LABEL, type LightState } from './core';
import { startBridge, type AssistantReply } from './bridge';
import { pauseSpeaking, resumeSpeaking, speak, speakerState, stopSpeaking, FOLDER } from './engine';
import { light, onLight } from './light';
import { agentName, loadVoice, onVoiceData, profileOf, voiceData } from './store';
import { AgentVoiceConsole, CloudPanel, GlobalPronunciationsPanel, ImportExportPanel, LiveLight, MicPanel } from './console';
import { AssistantHead, AssistantMic, ReplySpeak, VIEW } from './assistant';
import { appMenu } from './menu';
import './agent-voice.css';

/*
 * Agent voice (Oct 29 2026, Brett). Agents speak their replies with a per-agent voice and narrator, the Assistant gets
 * a microphone, and a live status light shows on the banner and in the Assistant title bar while the selected agent is
 * a voice agent.
 *  - view "agent-voice": the per-agent configuration console (nav → Plugins → Agent voice)
 *  - Settings → Plugins → Agent voice: microphone, cloud voices, pronunciations, live light, import/export, lifecycle
 *  - hooks into its settings: app menu (Plugins + View), right-click on any page, the banner light, the Assistant's
 *    title bar light and its mic popover, and actions (search) — Brett: "hooks to its settings in multiple places"
 *  - the Assistant: slots `assistant.mic`, `assistant.head`, `assistant.reply`; events in bridge.ts
 * Never names another plugin's folder; works with no agent manager (no agents) and no assistant (no mic).
 */

export const ID = 'ai.amberx.axf.console.agent-voice';
const ASSET_ID = 'agent-voice';
const COUNTER = 'agentvoice.live';
const K = { banner: 'agent-voice.banner', assistantLight: 'agent-voice.assistantLight' } as const;
const BANNER_MODES = ['lit', 'always', 'off'] as const;

/** The agent to open the console on (set by agent-voice.configure:<id>). */
let pendingAgent = '';

/* ---------------------------------------------------------------- the banner light */

const TONE: Record<LightState, string> = { off: 'neutral', ready: 'success', speaking: 'accent', listening: 'warning', paused: 'neutral', error: 'danger' };
let painted = '';
function paintBanner(rt: AxfRuntime) {
  const l = light();
  const mode = String(rt.settings.get(K.banner) ?? 'lit');
  const show = mode === 'always' || (mode === 'lit' && l.state !== 'off');
  const key = JSON.stringify([l.state, l.agentName, show]);
  if (key === painted) return;
  painted = key;
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Agent voice', version: '0.1.0', author: 'Agent voice plugin',
    description: 'Lit while the selected agent is a voice agent: ready, speaking, listening, paused.', tags: ['voice', 'status'],
    data: { counter: COUNTER, onLabel: `${l.agentName || 'Voice'} · ${LIGHT_LABEL[l.state].toLowerCase()}`, offLabel: 'Voice off', onTone: TONE[l.state], offTone: 'neutral', dot: true, link: l.agentId ? `agent-voice.configure:${encodeURIComponent(l.agentId)}` : 'agent-voice.open' },
  } as never, 'app', ID);
  rt.setBadge(COUNTER, l.state === 'off' ? 0 : 1);
  if (show) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'right', order: 22, origin: ID });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

/* ---------------------------------------------------------------- replies → speech */

function onReply(r: AssistantReply) {
  const p = profileOf(r.agentId);
  if (!p?.enabled || !p.permissions.speak) return;
  if (p.autoSpeak === 'off' || (p.autoSpeak === 'voice-only' && !r.viaVoice)) return;
  sayAs(r.agentId, r.agentName, r.text);
}

function sayAs(agentId: string, name: string, text: string) {
  const p = profileOf(agentId);
  if (!p) return;
  const mic = voiceData().store.mic;
  speak({
    profile: p, agentName: name || agentName(agentId), text, global: voiceData().store.pronunciations, holdMic: mic.muteWakeWhileSpeaking,
    onDone: () => {
      // Conversation mode: the mic opens again for the answer (the Assistant's mic does the listening).
      if (p.conversation && p.permissions.listen && !speakerState().speaking) window.dispatchEvent(new CustomEvent('axf:agent-voice.listen', { detail: { agentId } }));
    },
  });
}

/* ---------------------------------------------------------------- "Talk to <agent>" actions */

const talkOff = new Map<string, () => void>();
function syncTalkActions(rt: AxfRuntime) {
  const want = new Map<string, string>();
  for (const [id, p] of Object.entries(voiceData().store.profiles)) if (p.enabled && p.permissions.wakeName && p.permissions.listen) want.set(id, agentName(id));
  for (const [id, off] of talkOff) if (!want.has(id)) { off(); talkOff.delete(id); }
  for (const [id, name] of want) {
    if (talkOff.has(id)) continue;
    talkOff.set(id, rt.actions.register(`agent-voice.talk.${id}`, () => talkTo(rt, id), { label: `Talk to ${name}` }));
  }
}

function talkTo(rt: AxfRuntime, agentId: string) {
  rt.dispatch('ai-assistant.open');
  // the assistant picks the agent and the mic starts listening once the window is up
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('axf:assistant.focus', { detail: { agentId } }));
    setTimeout(() => window.dispatchEvent(new CustomEvent('axf:agent-voice.listen', { detail: { agentId } })), 400);
  }, 500);
}

/* ---------------------------------------------------------------- pages */

function ConsolePage() {
  const [agent, setAgent] = useState(pendingAgent);
  useEffect(() => {
    const on = () => setAgent(pendingAgent);
    window.addEventListener('axf:agent-voice.configure', on);
    return () => window.removeEventListener('axf:agent-voice.configure', on);
  }, []);
  return <AgentVoiceConsole initialAgent={agent || undefined} />;
}

function QuickPanel() {
  return (
    <Container title="Agent voice" icon="mic">
      <p className="fx-small fx-muted">Each agent's voice, narrator and permissions live on the Agent voice page.</p>
      <p><LiveLight withLabel /></p>
      <OpenButtons />
    </Container>
  );
}

function OpenButtons() {
  const rt = useRuntime();
  return <Button icon="sliders" onClick={() => rt.dispatch('agent-voice.open')}>Open Agent voice</Button>;
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Agent voice',
  version: '0.1.0',
  appMenu,
  provides: ['axf.agent-voice@1'],
  builtWith: { model: 'opus', builtAt: '2026-10-30' },
  register(rt) {
    void loadVoice();
    startBridge(onReply);
    const paint = () => { paintBanner(rt); };
    onLight(paint);
    rt.settings.onChange(K.banner, () => { painted = ''; paint(); });
    paint();
    onVoiceData(() => syncTalkActions(rt));
    window.addEventListener('axf:agent-voice.say', (e) => { const d = (e as CustomEvent<{ agentId: string; agentName: string; text: string }>).detail; if (d?.text) sayAs(d.agentId, d.agentName, d.text); });
    rt.actions.register('agent-voice.open', () => rt.navigate(VIEW), { label: 'Agent voice: configure agent voices' });
    rt.actions.register('agent-voice.configure', ([id]) => {
      pendingAgent = decodeURIComponent(id ?? '');
      rt.navigate(VIEW);
      window.dispatchEvent(new CustomEvent('axf:agent-voice.configure'));
    }, { label: 'Configure an agent\'s voice', params: true, searchable: false });
    rt.actions.register('agent-voice.settings', () => rt.dispatch('settings.open:agent-voice'), { label: 'Agent voice: microphone & cloud voice settings' });
    rt.actions.register('agent-voice.stop', () => stopSpeaking(), { label: 'Stop the agent talking' });
    rt.actions.register('agent-voice.pause', () => pauseSpeaking(), { label: 'Pause the agent' });
    rt.actions.register('agent-voice.resume', () => resumeSpeaking(), { label: 'Resume the agent' });
  },
  views: { [VIEW]: { title: 'Agent voice', icon: 'mic', render: () => <ConsolePage /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Agent voice', icon: 'mic', view: VIEW }] },
  contextMenu: [{ id: 'agent-voice.ctx', target: '*', order: 60, items: [
    { id: 'agent-voice.open', label: 'Agent voice…', icon: 'mic', action: 'agent-voice.open' },
    { id: 'agent-voice.stop', label: 'Stop the agent talking', icon: 'x', action: 'agent-voice.stop' },
  ] }],
  slots: {
    'assistant.mic': [{ id: 'agent-voice.mic', order: 10, render: (p) => <AssistantMic agentId={String(p.agentId ?? '')} agentName={String(p.agentName ?? '')} /> }],
    'assistant.head': [{ id: 'agent-voice.head', order: 10, render: (p) => <AssistantHeadGate agentId={String(p.agentId ?? '')} agentName={String(p.agentName ?? '')} /> }],
    'assistant.reply': [{ id: 'agent-voice.reply', order: 10, render: (p) => <ReplySpeak agentId={String(p.agentId ?? '')} agentName={String(p.agentName ?? '')} text={String(p.text ?? '')} /> }],
  },
  settingsTabs: [{ id: 'agent-voice', label: 'Agent voice', icon: 'mic', order: 35, parent: 'plugins', description: 'Agent voices, the Assistant microphone, cloud voices and pronunciations. Keys stay on the server.' }],
  settings: [
    { id: 'agent-voice.light', label: 'Live status light', icon: 'eye', tab: 'agent-voice', order: 5, settings: [
      { key: K.banner, label: 'On the banner', kind: 'choice', default: 'lit', options: BANNER_MODES.map((v) => ({ value: v, label: v === 'lit' ? 'Only while a voice agent is selected' : v === 'always' ? 'Always (grey when off)' : 'Never' })) },
      { key: K.assistantLight, label: 'In the Assistant title bar', kind: 'toggle', default: true },
    ] },
  ],
  settingsPanels: [
    { id: 'agent-voice.quick', tab: 'agent-voice', title: 'Agent voices', icon: 'mic', order: 1, render: () => <QuickPanel /> },
    { id: 'agent-voice.mic', tab: 'agent-voice', title: 'Assistant microphone', icon: 'mic', order: 10, render: () => <MicPanel /> },
    { id: 'agent-voice.cloud', tab: 'agent-voice', title: 'Cloud voices', icon: 'cloud', order: 20, render: () => <CloudPanel /> },
    { id: 'agent-voice.pron', tab: 'agent-voice', title: 'Pronunciations (every agent)', icon: 'edit', order: 30, render: () => <GlobalPronunciationsPanel /> },
    { id: 'agent-voice.io', tab: 'agent-voice', title: 'Import & export', icon: 'download', order: 40, render: () => <ImportExportPanel /> },
    { id: 'agent-voice.lifecycle', tab: 'agent-voice', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

/** The title-bar light honours its setting. */
function AssistantHeadGate(p: { agentId: string; agentName: string }) {
  const rt = useRuntime();
  if (rt.settings.get(K.assistantLight) === false) return null;
  return <AssistantHead {...p} />;
}
