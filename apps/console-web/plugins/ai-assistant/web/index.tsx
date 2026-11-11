import { Button, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { APPROVALS_BADGE_KEY, FOLDER, ID, type Ctx } from './api';
import { ActivityIcon } from './activity';
import { ChatPanel, type ChatStart, useStatus } from './chat';
import { BehaviorPanel, HandsFreePanel, PromptsPanel, ProvidersPanel, SessionsPanel, SetupWizard, UsagePanel } from './settings';
import { setHandsFree } from './handsfree';
import { isAssistantPage, openInHost, startHostBridge, type HostStart } from './host';
import './ai-assistant.css';
import { appMenu } from './menu';

/*
 * AI assistant plugin (web part, Fable rebuild). The chat UI is built on the framework's assistant contract
 * (assistant@1, framework/core/assistant.ts: types, HttpAssistantClient, watchReply) so other AXF apps
 * can reuse the same core — see server/__init__.py for the engine.
 *  - view "ai-assistant": full-page chat (nav → Plugins → AI assistant)
 *  - dialog "ai-assistant.chat": the chat dialog, from anywhere (action ai-assistant.open, payload = optional prompt)
 *  - the chat's title bar carries lib-approvals' badge (axHub approvals + held calls, click to decide; Oct 28 2026)
 *  - Settings → Plugins → AI assistant: setup wizard, providers, behaviour, prompts, usage, install & uninstall
 * Talks to the agent manager only through the server's axf.agents@1 lookup, so either plugin can be removed cleanly.
 */

function AssistantView() {
  const s = useStatus();
  return (
    <div className="fx-stack">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">AI · assistant</p><h1 className="axp-ai-assistant__h1"><ActivityIcon size={20} />{s?.assistantName ?? 'AI assistant'}</h1><p className="fx-muted axp-ai-assistant__lede" title="Chat with the framework's assistant or a specialist agent; anything that writes asks you first.">Chat with the assistant or an agent; writes ask you first.</p></div></header>
      <ChatPanel />
    </div>
  );
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
    // Inside a host that owns the assistant (Molly's AI assistant plugin, host.ts), opening it asks the host: one copy on
    // screen. The page the host frames (`axf-embed-page=view:ai-assistant`) is that copy and starts chats it is handed.
    startHostBridge(({ start, note }) => {
      if (start?.agentId) window.dispatchEvent(new CustomEvent('axf:assistant.focus', { detail: { agentId: start.agentId } }));
      if (start?.message) setTimeout(() => window.dispatchEvent(new CustomEvent('axf:assistant.input', { detail: { text: start.message, send: true, partial: false } })), start.agentId ? 300 : 0);
      else if (note) window.dispatchEvent(new CustomEvent('axf:assistant.input', { detail: { text: note, send: false, partial: false } }));
    });
    rt.actions.register('ai-assistant.open', ([prompt]) => {
      if (openInHost(prompt ? { note: prompt } : {})) return;
      if (isAssistantPage()) { if (prompt) window.dispatchEvent(new CustomEvent('axf:assistant.input', { detail: { text: prompt, send: false, partial: false } })); return; }
      rt.openDialog('ai-assistant.chat', prompt ? { note: prompt } : {});
    }, { label: 'Open the AI assistant' });
    // Generic, capability-style action other plugins use (never this folder's name):
    //   ai.chat.start:<uri-encoded JSON {agentId?, message, title?, profileId?, model?}>
    rt.actions.register('ai.chat.start', ([arg]) => {
      let start: ChatStart | null = null;
      try { start = JSON.parse(decodeURIComponent(arg ?? '')) as ChatStart; } catch { /* bad payload */ }
      if (!start?.message) return;
      if (openInHost({ start: start as HostStart })) return;
      rt.openDialog('ai-assistant.chat', { start });
    }, { label: 'Start an AI chat with an agent', params: true, searchable: false });
    // Hands-free voice from anywhere (menus, toolbars, search, console_action, voice): on | off | toggle (default toggle).
    rt.actions.register('ai-assistant.hands-free', ([how]) => {
      const want = how === 'on' ? { on: true } : how === 'off' ? { on: false } : { toggle: true };
      void setHandsFree(want).then((hf) => rt.toast(`Hands-free voice ${hf.on ? 'on: say the wake word, then your message' : 'off'}`, 'success', 'AI assistant'), (e: Error) => rt.toast(e.message, 'error', 'AI assistant'));
    }, { label: 'Hands-free voice on / off', params: true });
  },
  views: { 'ai-assistant': { title: 'AI assistant', icon: 'sparkles', render: () => <AssistantView /> } },
  dialogs: {
    'ai-assistant.chat': {
      title: 'AI assistant',
      icon: 'sparkles',
      render: (props, close) => <div className="axp-ai-assistant__dialog"><ChatPanel compact initialContext={(props as Ctx).note || (props as Ctx).view ? (props as Ctx) : undefined} onClose={close} start={(props as { start?: ChatStart }).start} openId={(props as { open?: string }).open} /></div>,
    },
  },
  nav: { label: 'Plugins', items: [{ id: 'ai-assistant', label: 'AI assistant', icon: 'sparkles', view: 'ai-assistant' }] },
  settingsTabs: [{ id: 'ai-assistant', label: 'AI assistant', icon: 'sparkles', order: 30, description: 'Providers, defaults, personality, prompts and usage for the AI assistant. Keys stay on the console server.' }],
  settings: [
    { id: 'ai-assistant.titlebar', label: 'Title bar', icon: 'shield', tab: 'ai-assistant', order: 6, settings: [
      { key: APPROVALS_BADGE_KEY, label: 'Show axHub approvals in the chat title bar', kind: 'toggle', default: true, description: 'A count while axHub has calls waiting (nothing when none). Click it to Approve / Decline on the hub page, or Deny a held command before its countdown ends.' },
    ] },
  ],
  settingsPanels: [
    // First on the tab (Brett: "Easy to reach, hands free. A setting in AI assistant.")
    { id: 'ai-assistant.hands-free', tab: 'ai-assistant', title: 'Hands-free voice', icon: 'mic', order: 1, render: () => <HandsFreePanel /> },
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
