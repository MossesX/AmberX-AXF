import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { APPROVALS_BADGE_KEY, FOLDER, ID, type Ctx } from './api';
import { ActivityIcon } from './activity';
import { AssistantChat, type ChatStart, useStatus } from './gizmo';
import { TALK_KEYS, requestTalk } from './talk';
import { BehaviorPanel, PromptsPanel, ProvidersPanel, SessionsPanel, SetupWizard, UsagePanel } from './settings';
import './ai-assistant.css';
import { appMenu } from './menu';

/*
 * AI assistant plugin (web). Nov 10 2026 (Brett): the old console assistant chat is gone; the chat is Gizmo, moved
 * here from AmberX (./gizmo.tsx), on the same engine (assistant@1, server/__init__.py), so AmberX's Gizmo and this
 * screen share every chat.
 *  - view "ai-assistant": the chat full page (deep link: console_open / console_show "ai-assistant", nav:ai-assistant)
 *  - dialog "ai-assistant.chat": the chat from anywhere (action ai-assistant.open, payload = optional prompt)
 *  - actions: ai-assistant.open | .new | .talk | .model:<claude:opus|claude:fable|ollama|model> | .agent:<id>, ai.chat.start
 *  - Settings → Plugins → AI assistant: setup wizard, providers (Claude, Ollama…), behaviour, voice, prompts, usage
 * Talks to the agent manager only through the server's axf.agents@1 lookup and the generic `agents.open` action.
 */

function AssistantView() {
  const s = useStatus();
  return (
    <div className="fx-stack">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">AI · assistant</p><h1 className="axp-ai-assistant__h1"><ActivityIcon size={20} />AI assistant</h1><p className="fx-muted axp-ai-assistant__lede" title="Gizmo and every agent from the agents section, on Claude or a local Ollama model; type or talk.">{s?.agents.some((a) => a.id === 'gizmo') ? 'Gizmo and your agents, on Claude or a local model.' : 'Chat with the assistant or an agent, on Claude or a local model.'}</p></div></header>
      <AssistantChat />
    </div>
  );
}

/** Pending per-chat changes asked for by an action before a chat was open (model / agent for the next new chat). */
function setNext(kind: 'model' | 'agent', value: string) {
  window.dispatchEvent(new CustomEvent('axf:assistant.focus', { detail: kind === 'agent' ? { agentId: value } : {} }));
  if (kind === 'model') window.dispatchEvent(new CustomEvent('axf:ai-assistant.model', { detail: { model: value } }));
}

function WizardIntro() {
  const s = useStatus();
  // flat inside its settings panel (no card in a card); collapsed once setup is done
  return (
    <details className="axp-ai-assistant__fold" open={s ? !s.setupComplete : false}>
      <summary className="fx-small">{s?.setupComplete ? 'Run the setup wizard again' : 'Start the setup wizard'}</summary>
      <SetupWizard />
    </details>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'AI assistant',
  version: '0.4.0',
  appMenu,
  provides: ['axf.ai-assistant', 'axf.llm@1', 'axf.live-sessions@1'],
  register(rt) {
    rt.actions.register('ai-assistant.open', ([prompt]) => rt.openDialog('ai-assistant.chat', prompt ? { note: prompt } : {}), { label: 'Open the AI assistant' });
    rt.actions.register('ai-assistant.new', () => { try { localStorage.removeItem('axf-ai-assistant:last'); } catch { /* private mode */ } rt.navigate('ai-assistant'); }, { label: 'New AI assistant chat' });
    rt.actions.register('ai-assistant.talk', () => { rt.navigate('ai-assistant'); requestTalk(); }, { label: 'Talk to the AI assistant (voice chat)' });
    rt.actions.register('ai-assistant.model', ([m]) => { if (m) setNext('model', m); }, { label: 'Switch the open chat\'s model (claude:opus, claude:fable, ollama or a model name)', params: true });
    rt.actions.register('ai-assistant.agent', ([id]) => { if (id) setNext('agent', id); }, { label: 'Switch the open chat\'s agent', params: true });
    // Generic, capability-style action other plugins use (never this folder's name):
    //   ai.chat.start:<uri-encoded JSON {agentId?, message, title?, profileId?, model?}>
    rt.actions.register('ai.chat.start', ([arg]) => {
      let start: ChatStart | null = null;
      try { start = JSON.parse(decodeURIComponent(arg ?? '')) as ChatStart; } catch { /* bad payload */ }
      if (start?.message) rt.openDialog('ai-assistant.chat', { start });
    }, { label: 'Start an AI chat with an agent', params: true, searchable: false });
  },
  views: { 'ai-assistant': { title: 'AI assistant', icon: 'sparkles', render: () => <AssistantView /> } },
  dialogs: {
    'ai-assistant.chat': {
      title: 'AI assistant',
      icon: 'sparkles',
      render: (props, close) => <div className="axp-ai-assistant__dialog"><AssistantChat compact initialContext={(props as Ctx).note || (props as Ctx).view ? (props as Ctx) : undefined} onClose={close} start={(props as { start?: ChatStart }).start} openId={(props as { open?: string }).open} /></div>,
    },
  },
  nav: { label: 'Plugins', items: [{ id: 'ai-assistant', label: 'AI assistant', icon: 'sparkles', view: 'ai-assistant' }] },
  settingsTabs: [{ id: 'ai-assistant', label: 'AI assistant', icon: 'sparkles', order: 30, description: 'Providers, defaults, personality, prompts and usage for the AI assistant. Keys stay on the console server.' }],
  settings: [
    { id: 'ai-assistant.voice', label: 'Voice chat', icon: 'mic', tab: 'ai-assistant', order: 7, settings: [
      { key: TALK_KEYS.speak, label: 'Speak replies in voice chat', kind: 'toggle', default: true },
      { key: TALK_KEYS.speakAlways, label: 'Speak every reply (typed ones too)', kind: 'toggle', default: false },
      { key: TALK_KEYS.handsFree, label: 'Voice chat keeps listening (hands-free)', kind: 'toggle', default: true, description: 'Off: tap the mic for each turn.' },
      { key: TALK_KEYS.interrupt, label: 'Stop talking when I say "stop"', kind: 'toggle', default: true },
      { key: TALK_KEYS.rate, label: 'Speech speed', kind: 'slider', default: 1, min: 0.5, max: 2, step: 0.05 },
      { key: TALK_KEYS.lang, label: 'Speech language', kind: 'text', default: '', description: 'A BCP-47 tag such as en-US; empty = the browser language.' },
    ] },
    { id: 'ai-assistant.titlebar', label: 'Title bar', icon: 'shield', tab: 'ai-assistant', order: 6, settings: [
      { key: APPROVALS_BADGE_KEY, label: 'Show axHub approvals in the chat title bar', kind: 'toggle', default: true, description: 'A count while axHub has calls waiting (nothing when none). Click it to Approve / Decline on the hub page, or Deny a held command before its countdown ends.' },
    ] },
  ],
  settingsPanels: [
    { id: 'ai-assistant.quick', tab: 'ai-assistant', title: 'Open the assistant', icon: 'sparkles', order: 5, render: () => <QuickOpen /> },
    { id: 'ai-assistant.wizard', tab: 'ai-assistant', title: 'Setup wizard', icon: 'rocket', order: 10, render: () => <WizardIntro /> },
    { id: 'ai-assistant.providers', tab: 'ai-assistant', title: 'Providers', icon: 'cloud', order: 20, render: () => <ProvidersPanel /> },
    { id: 'ai-assistant.behavior', tab: 'ai-assistant', title: 'Behaviour & defaults', icon: 'sliders', order: 30, render: () => <BehaviorPanel /> },
    { id: 'ai-assistant.prompts', tab: 'ai-assistant', title: 'Prompt library', icon: 'list', order: 40, render: () => <PromptsPanel /> },
    { id: 'ai-assistant.sessions', tab: 'ai-assistant', title: 'Live sessions', icon: 'cloud', order: 45, render: () => <SessionsPanel /> },
    { id: 'ai-assistant.usage', tab: 'ai-assistant', title: 'Usage', icon: 'chart', order: 50, render: () => <UsagePanel /> },
    { id: 'ai-assistant.lifecycle', tab: 'ai-assistant', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

function QuickOpen() {
  const rt = useRuntime();
  return (
    <div className="fx-row">
      <Button tone="primary" icon="sparkles" title="Also: Plugins → AI assistant, the action ai-assistant.open, or from any plugin ai.chat.start" onClick={() => rt.openDialog('ai-assistant.chat')}>Open chat dialog</Button>
      <Button icon="external" onClick={() => rt.navigate('ai-assistant')}>Chat page</Button>
    </div>
  );
}
