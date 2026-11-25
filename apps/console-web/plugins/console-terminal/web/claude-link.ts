/*
 * Claude link — its settings in the settings registry (Settings → Plugins → Terminal → Claude link). The registry
 * draws the controls, keeps the values (rt.settings) and makes each one a control target, so REST, MCP, the CLI and
 * voice read and change them like any other setting. Levels: the plugin's settings asset (levelOf) and LEVELS.
 */
import type { SettingsGroup } from '@console/axf/core/settings';
import { BUFFER, DEFAULTS, KEYS, KIND_LABELS, KINDS, readPrefs, type ClaudeLinkPrefs } from './claude-link-core';

export const CLAUDE_LINK_GROUP_ID = 'terminal.claude-link';

export const claudeLinkSettings: SettingsGroup & { level: string } = {
  id: CLAUDE_LINK_GROUP_ID,
  label: 'Claude link',
  icon: 'activity',
  tab: 'terminal',
  order: 9,
  level: 'basic',
  description: 'The Claude link tab: a live, read-only log of the console’s connection to Claude (session launches and exits, account use, MCP and axHub calls, connects, disconnects and errors).',
  settings: [
    { key: KEYS.autoScroll, label: 'Auto-scroll', kind: 'toggle', default: DEFAULTS.autoScroll, scope: 'device', description: 'Follow new lines as they arrive. Scrolling up pauses it; the tab’s Pause button does too.' },
    { key: KEYS.kinds, label: 'Kinds shown by default', kind: 'multi_choice', default: [...DEFAULTS.kinds], options: KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })), scope: 'device', description: 'What the filter starts on when the tab opens. None picked = every kind.' },
    { key: KEYS.showDetail, label: 'Show detail by default', kind: 'toggle', default: DEFAULTS.showDetail, scope: 'device', description: 'Open each line’s detail (arguments, exit kind, the reason) without a tap.' },
    { key: KEYS.buffer, label: 'Buffer size (lines)', kind: 'slider', default: DEFAULTS.buffer, min: BUFFER.min, max: BUFFER.max, step: BUFFER.step, scope: 'device', description: 'How many lines the tab keeps; the oldest drop off first.' },
  ],
};

/** The Claude link settings as they are saved now. */
export const claudeLinkPrefs = (rt: { settings: { get(key: string): unknown } }): ClaudeLinkPrefs => readPrefs((k) => rt.settings.get(k));
