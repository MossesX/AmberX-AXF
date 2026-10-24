/**
 * Claude connection badge (Brett, Oct 24 2026): on every load Patches asks its server (GET /api/claude → the Dev
 * Console's claude-connection plugin) whether Claude Code connects, by subscription or API key, and repaints its
 * attachable badge `badge/claude-connection` (attached at the top left of the `patches` banner): green Claude logo +
 * the active account's email, or red + "No Claude connection · check keys" (tap opens the console's AI keys settings).
 */
import { normalizeStateLook, stateLookFor, type AxfRuntime } from './axf/core';
import { api } from './api';
import base from './assets/badge/claude-connection.json';

export interface ClaudeStatus { at?: number; ok: boolean; mode?: string; email?: string; account?: string; model?: string; error?: string; look?: unknown }

export const NO_CONNECTION = 'No Claude connection · check keys';

/** The badge's data for a check result (null = still checking). Pure. */
export function claudeBadgeData(s: ClaudeStatus | null) {
  if (!s) return { ...base.data };
  // the look picked in the console (Settings → Plugins → Claude connection): two icons, or one icon in two colours
  const { icon, tone } = stateLookFor(normalizeStateLook(s.look, base.data.icon), s.ok);
  if (s.ok) {
    const how = s.mode === 'subscription' ? 'Claude subscription' : s.mode === 'api-key' ? 'API key' : 'Claude';
    return { ...base.data, icon, label: s.email || s.account || how, tone, tooltip: `Claude Code connected · ${how}${s.model ? ` · ${s.model}` : ''}`, link: 'patches.claude.check' };
  }
  return { ...base.data, icon, label: NO_CONNECTION, tone, tooltip: `No Claude connection${s.error ? `: ${s.error}` : ''}. Tap to check the keys.`, link: 'patches.claude.keys' };
}

export function paintClaude(rt: AxfRuntime, s: ClaudeStatus | null) {
  rt.registry.register({ ...base, data: claudeBadgeData(s) }, 'app', 'patches-web.claude');
  rt.attachToBanner({ type: 'badge', id: base.id, at: 'left', order: 0, origin: 'patches-web.claude' });
}

let running: Promise<ClaudeStatus> | null = null;

/** Check the connection and repaint the badge (one check at a time). */
export function checkClaude(rt: AxfRuntime, refresh = false): Promise<ClaudeStatus> {
  if (running) return running;
  paintClaude(rt, null);
  running = api<ClaudeStatus>(`/claude${refresh ? '?refresh=true' : ''}`)
    .then((r) => (r.ok && r.data ? r.data : { ok: false, error: r.error || `Patches' server answered ${r.status}` }))
    .then((s) => { paintClaude(rt, s); return s; })
    .finally(() => { running = null; });
  return running;
}
