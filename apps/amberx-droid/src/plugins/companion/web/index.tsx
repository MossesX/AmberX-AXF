/**
 * Companion: Gizmo, Brett's Claude companion in AmberX (build gizmo-companion, Nov 3 2026). A full-screen chat and talk
 * mode on the phone; the brains run on the VPS as the Dev Console's AI assistant (assistant@1, Claude Code on the Claude
 * plan) as agent Gizmo, reached through AmberX's server behind the axHub wall, so no key is ever in the APK.
 * Shared parts (names, models, speech, budget, tool cards) come from the framework's claude-session library.
 *
 * HOOKS other plugins use (keep these names):
 *   action `companion.open`          open Gizmo (where it was)
 *   action `companion.new`           open Gizmo on a new chat
 *   action `companion.talk`          open Gizmo in talk mode (hands-free)
 *   voice  "hey gizmo", "talk to gizmo", "open gizmo" (voice plugin commands)
 */
import { useEffect, useState } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, SelectField, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { COMPANION, chatModels } from '../../../axf/libs/claude-session';
import { registerVoiceCommands } from '../../voice/web';
import { COMPANION_ID, download, exportAll, client } from './api';
import { CompanionView } from './Chat';
import { K } from './keys';
import { MIRROR, forgetChat } from './mirror';
import { requestTalk, sample, voices } from './talk';
import './companion.css';

const VERSION = '0.1.0';

function VoicePanel() {
  const rt = useRuntime();
  const [list, setList] = useState<{ id: string; name: string; lang: string }[]>([]);
  const [voice, setVoice] = useState(String(rt.settings.get(K.voice) ?? ''));
  useEffect(() => { void voices().then(setList); }, []);
  return (
    <div className="axp-companion-voice">
      <SelectField label="Gizmo's voice" value={voice} empty="The device's default voice" options={list.map((v) => ({ value: v.id, label: `${v.name} (${v.lang})` }))}
        onChange={(v) => { setVoice(v); rt.settings.set(K.voice, v); }} hint={list.length ? `${list.length} voices on this device.` : 'No voices listed by this device (the default voice is used).'} />
      <div className="fx-row"><Button size="sm" icon="play" onClick={() => void sample(rt)}>Try it</Button></div>
    </div>
  );
}

function ChatsPanel() {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const exportEvery = async () => {
    setBusy(true);
    try { const r = await exportAll(); download(`gizmo-chats-${new Date().toISOString().slice(0, 10)}.json`, r.text, 'application/json'); rt.toast(`${r.count} chats exported`, 'success', 'Gizmo'); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Gizmo'); } finally { setBusy(false); }
  };
  const deleteEvery = async () => {
    if (!globalThis.confirm?.("Delete every Gizmo chat? They go from the VPS and their copies on axHub. This can't be undone.")) return;
    setBusy(true);
    try {
      const items = [...await client.listConversations(''), ...await client.listConversations('', true)].filter((c) => !c.agentId || c.agentId === COMPANION.agentId);
      for (const c of items) { await client.deleteConversation(c.id); await forgetChat(c.id); }
      rt.toast(`${items.length} chats deleted`, 'success', 'Gizmo');
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Gizmo'); } finally { setBusy(false); }
  };
  return (
    <div className="fx-stack">
      <p className="fx-muted">Chats live on the VPS (the console's assistant); a text copy of each is kept on axHub in {MIRROR.project}/_data/{MIRROR.folder}/{MIRROR.table} while “Keep a copy” is on.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="download" busy={busy} onClick={() => void exportEvery()}>Export all chats</Button>
        <Button tone="danger" icon="trash" busy={busy} confirm="Delete every Gizmo chat?" onClick={() => void deleteEvery()}>Delete all chats</Button>
      </div>
    </div>
  );
}

function open(rt: AxfRuntime) { rt.navigate('companion'); }

export const library: AxfWebLibrary = {
  id: COMPANION_ID,
  label: COMPANION.name,
  version: VERSION,
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  provides: ['amberx.companion'],
  views: { companion: { title: COMPANION.name, icon: 'sparkles', keywords: ['gizmo', 'companion', 'chat', 'claude', 'assistant', 'talk', 'ask', 'sidekick'], render: () => <CompanionView /> } },
  nav: { label: 'Gizmo', items: [{ id: 'companion', label: COMPANION.name, icon: 'sparkles', view: 'companion' }] },
  appMenu: [{
    id: 'amberx.companion', menu: 'axhub', items: [
      { id: 'companion.open', label: `Chat with ${COMPANION.name}`, icon: 'sparkles', action: 'companion.open' },
      { id: 'companion.talk', label: `Talk to ${COMPANION.name}`, icon: 'mic', action: 'companion.talk' },
    ],
  }],
  contextMenu: [{ id: 'amberx.companion', items: [{ id: 'companion.open', label: `Ask ${COMPANION.name}`, icon: 'sparkles', action: 'companion.open' }] }],
  settingsTabs: [{ id: 'companion', label: COMPANION.name, icon: 'sparkles', order: 12, parent: 'plugins', description: "Gizmo, your Claude companion: model, voice, how he talks, tools, chats and privacy." }],
  settings: [
    { id: 'companion.brain', label: 'Model and personality', icon: 'sparkles', tab: 'companion', order: 1, settings: [
      { key: K.model, label: 'Model for new chats', kind: 'choice', default: '', options: [{ value: '', label: 'Default (Opus)' }, ...chatModels().map((m) => ({ value: m.key, label: m.label }))], description: 'Opus or Fable only (model policy): Sonnet and Haiku run as Opus. Each chat can switch in its title bar.' },
      { key: K.persona, label: 'Personality and instructions', kind: 'text', default: '', description: "Your own words added to every new chat's instructions (how Gizmo talks, what to remember about you)." },
    ] },
    { id: 'companion.voice', label: 'Talk mode and voice', icon: 'mic', tab: 'companion', order: 10, settings: [
      { key: K.speak, label: 'Speak replies in talk mode', kind: 'toggle', default: true },
      { key: K.speakAlways, label: 'Speak every reply (typed ones too)', kind: 'toggle', default: false },
      { key: K.handsFree, label: 'Talk mode keeps listening (hands-free)', kind: 'toggle', default: true, description: 'Off: talk mode waits for the push-to-talk button each turn.' },
      { key: K.interrupt, label: 'Stop talking when I talk over Gizmo', kind: 'toggle', default: true, description: 'Say "stop", "wait" or "hold on" while he talks and he stops at once.' },
      { key: K.rate, label: 'Speech speed', kind: 'slider', default: 1, min: 0.5, max: 2, step: 0.05 },
    ] },
    { id: 'companion.tools', label: 'Tools, connectors and notifications', icon: 'zap', tab: 'companion', order: 20, settings: [
      { key: K.tools, label: 'Tools and connectors in new chats', kind: 'toggle', default: true, description: 'axHub services (GitHub, VPS, Hostinger, the console, AmberX…), the repo and the crew, with the same approvals and veto countdowns as everywhere else.' },
      { key: K.showTools, label: 'Show tool calls as cards', kind: 'toggle', default: true },
      { key: K.notify, label: 'Tell me when a reply finishes while I am elsewhere', kind: 'toggle', default: true },
    ] },
    { id: 'companion.privacy', label: 'Chats, budget and privacy', icon: 'shield', tab: 'companion', order: 30, settings: [
      { key: K.mirror, label: 'Keep a copy of my chats on axHub', kind: 'toggle', default: true },
      { key: K.dailyCapUsd, label: 'Daily cap (USD, 0 = none)', kind: 'number', default: 0, min: 0, max: 500, step: 1, description: "Estimated from today's assistant tokens at the model's price; sending stops at the cap." },
    ] },
  ],
  settingsPanels: [
    { id: 'companion.voicepick', tab: 'companion', title: 'Voice', icon: 'mic', order: 15, render: () => <VoicePanel /> },
    { id: 'companion.chats', tab: 'companion', title: 'Your chats', icon: 'file', order: 35, render: () => <ChatsPanel /> },
  ],
  register(rt) {
    rt.actions.register('companion.open', () => open(rt), { label: `Chat with ${COMPANION.name}` });
    rt.actions.register('companion.new', () => { try { localStorage.removeItem('companion.last'); } catch { /* private mode */ } open(rt); }, { label: `New chat with ${COMPANION.name}` });
    rt.actions.register('companion.talk', () => { requestTalk(); open(rt); }, { label: `Talk to ${COMPANION.name}` });
    registerVoiceCommands(COMPANION_ID, [
      { id: 'companion.open', phrases: ['open gizmo', 'hey gizmo', 'chat with gizmo'], action: 'companion.open', reply: "Gizmo's here.", group: 'plugins', owner: COMPANION.name, defaultOn: true },
      { id: 'companion.talk', phrases: ['talk to gizmo', 'gizmo talk mode'], action: 'companion.talk', reply: 'Go ahead, I am listening.', group: 'plugins', owner: COMPANION.name, defaultOn: true },
    ]);
  },
};
