import { Button, Container, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID, type Ctx } from './api';
import { ChatPanel, type ChatStart, useStatus } from './chat';
import { BehaviorPanel, PromptsPanel, ProvidersPanel, SessionsPanel, SetupWizard, UsagePanel } from './settings';
import './ai-assistant.css';

/*
 * AI assistant plugin (web part). Ported from xGallery's assistant and extended — see server/__init__.py.
 *  - view "ai-assistant": full-page chat (nav → Plugins → AI assistant)
 *  - dialog "ai-assistant.chat": the chat dialog, from anywhere (action ai-assistant.open, payload = optional prompt)
 *  - Settings → Plugins → AI assistant: setup wizard, providers, behaviour, prompts, usage, install & uninstall
 * Talks to the agent manager only through the server's axf.agents@1 lookup, so either plugin can be removed cleanly.
 */

function AssistantView() {
  const s = useStatus();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>{s?.assistantName ?? 'AI assistant'}</h1></div></header>
      <ChatPanel />
    </div>
  );
}

function WizardIntro() {
  const s = useStatus();
  return (
    <Container title={s?.setupComplete ? 'Setup wizard (run again any time)' : 'Setup wizard'} icon="rocket">
      <SetupWizard />
    </Container>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'AI assistant',
  version: '0.1.0',
  provides: ['axf.ai-assistant'],
  register(rt) {
    rt.actions.register('ai-assistant.open', ([prompt]) => rt.openDialog('ai-assistant.chat', prompt ? { note: prompt } : {}), { label: 'Open the AI assistant' });
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
      render: (props, close) => <div className="axp-ai-assistant__dialog"><ChatPanel compact initialContext={(props as Ctx).note || (props as Ctx).view ? (props as Ctx) : undefined} onClose={close} start={(props as { start?: ChatStart }).start} /></div>,
    },
  },
  nav: { label: 'Plugins', items: [{ id: 'ai-assistant', label: 'AI assistant', icon: 'sparkles', view: 'ai-assistant' }] },
  settingsTabs: [{ id: 'ai-assistant', label: 'AI assistant', icon: 'sparkles', order: 30, description: 'Providers, defaults, personality, prompts and usage for the AI assistant. Keys stay on the console server.' }],
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
    <div className="fx-row fx-row--wrap">
      <Button tone="primary" icon="sparkles" onClick={() => rt.openDialog('ai-assistant.chat')}>Open chat dialog</Button>
      <span className="fx-small fx-muted">Also: nav → Plugins → AI assistant, or the action <code className="fx-mono">ai-assistant.open</code>.</span>
    </div>
  );
}
