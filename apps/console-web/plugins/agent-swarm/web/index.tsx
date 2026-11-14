import type { AxfWebLibrary } from '@console/axf/react/library';
import { Slot, useSlotFilled } from '@console/axf/react';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, SwarmCostChip, SwarmPage } from './ui';
import { COLOR_BY_VIBE_ACTION, KEYS } from './chat-settings';
import { VIBE_COLORS } from './swarm-core.mjs';
import { appMenu } from './menu';
import { PROFILE_EVENT } from './cards';
import { writeLocal } from '@console/api';
import { SectionOwnersPanel } from './sections';
import * as player from './chat-audio';
import { registerAudioActions, registerAudioVoice } from './audio-actions';

function Desks() {
  const filled = useSlotFilled('swarm.settings.desks');
  return filled ? <Slot name="swarm.settings.desks" /> : <p className="fx-small fx-muted" style={{ margin: 0 }}>No agent cap installed: every on-duty agent may run at once.</p>;
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.agent-swarm',
  label: 'Agent swarm',
  version: '0.3.0',
  register(rt) {
    // an agent's employee card (profile: info, stats, pay, history) from anywhere: agent-swarm.profile:<agent id>
    rt.actions.register('agent-swarm.profile', ([id = '']) => {
      if (!id) return;
      writeLocal('swarm-profile', id); writeLocal('swarm-tab', 'crew');
      rt.navigate('agent-swarm');
      setTimeout(() => window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: id })), 0);
    }, { label: 'Open an agent\'s employee card', params: true, searchable: false });
    // the Breakroom (group chat, Jobs) from other plugins: agent-swarm.open
    rt.actions.register('agent-swarm.open', () => rt.navigate('agent-swarm'), { label: 'Open the Breakroom', searchable: false });
    // group chat audio: this device's player (chat-audio.ts); the skin's voice cast is the active `voice` slot
    player.start({ device: rt.settings.get(player.AUDIO_KEYS.device) !== false, skinPick: () => String((rt.getState().active as Record<string, string>).voice ?? '') });
    rt.settings.onChange(player.AUDIO_KEYS.device, () => player.setDevice(rt.settings.get(player.AUDIO_KEYS.device) !== false));
    registerAudioActions(rt);
    void registerAudioVoice('ai.amberx.axf.console.agent-swarm');
    rt.actions.register(COLOR_BY_VIBE_ACTION, () => rt.settings.set(KEYS.colorByVibe, !rt.settings.get(KEYS.colorByVibe)), { label: 'Color chat messages by vibe' });
  },
  views: { 'agent-swarm': { title: 'Agent swarm', icon: 'user', keywords: ['swarm', 'agents', 'jobs', 'leases', 'cost', 'tokens', 'headless'], render: () => <SwarmPage /> } },
  appMenu,
  nav: { label: 'Builds', items: [{ id: 'agent-swarm', label: 'Agent swarm', icon: 'user', view: 'agent-swarm' }] },
  // the orchestrator's (and every Builds page's) toolbar shows what the swarm has spent
  slots: { 'builds.toolbar': [{ id: 'agent-swarm.cost', order: 30, render: () => <SwarmCostChip /> }] },
  // the chat window's right-click menu: Color by vibe, with its check mark
  contextMenu: [{ id: 'agent-swarm.chat', target: 'agent-swarm-chat', items: [{ id: 'agent-swarm.color-by-vibe', label: 'Color by vibe', icon: 'palette', action: COLOR_BY_VIBE_ACTION, checked: `setting:${KEYS.colorByVibe}` }] }],
  settings: [{
    id: 'agent-swarm.chat', label: 'Group chat', icon: 'palette', tab: FOLDER, order: 10,
    settings: [
      { key: KEYS.colorByVibe, label: 'Color by vibe', kind: 'toggle', default: false, description: 'Color every group-chat message by its vibe score: light near 1, darkest at the vibe ceiling.' },
      { key: player.AUDIO_KEYS.device, label: 'Play group chat audio on this device', kind: 'toggle', default: true, description: 'When group chat audio is on, this device reads new messages aloud. Turn it off here to keep this device quiet while another one plays.' },
      { key: KEYS.vibeColor, label: 'Vibe base colour', kind: 'choice', default: 'accent', options: VIBE_COLORS.map((c) => ({ value: c, label: c })), description: 'The theme colour the vibe shades are mixed from.' },
    ],
  }],
  settingsTabs: [{ id: 'agent-swarm', label: 'Agent swarm', icon: 'user', order: 91, parent: 'plugins' }],
  settingsPanels: [
    // Desks: how many agents may work at once. Filled by whichever plugin provides the VPS-wide agent cap (slot swarm.settings.desks).
    { id: 'agent-swarm.desks', tab: 'agent-swarm', title: 'Desks', icon: 'layers', order: 15, render: () => <Desks /> },
    // Section owners (crew-sections@1): who speaks for each section that acts on its own, in the group chat
    { id: 'agent-swarm.sections', tab: 'agent-swarm', title: 'Section owners', icon: 'user', order: 20, render: () => <SectionOwnersPanel /> },
    { id: 'agent-swarm.lifecycle', tab: 'agent-swarm', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
