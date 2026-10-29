/* Claude Code profiles (Oct 28 2026): "Claude code tabs need extra customization profiles". A profile says how a
   Claude Code tab starts: model, permission mode, extra flags, folder, a first prompt, its icon + tab colour and the
   connection it opens on by default. Kept in the plugin's settings (server-checked); edited in Settings → Plugins →
   Terminal → Claude Code profiles; picked in the connection picker and the new-tab menu. */
import { useEffect, useState } from 'react';
import { getSettings, onSettings, type ClaudeProfile, type Open } from './api';

export interface Profiles { items: ClaudeProfile[]; defaultId: string }
export function useProfiles(): Profiles {
  const [p, setP] = useState<Profiles>({ items: [], defaultId: '' });
  useEffect(() => {
    const take = (s: { claudeProfiles?: ClaudeProfile[]; defaultClaudeProfile?: string }) => setP({ items: s.claudeProfiles ?? [], defaultId: s.defaultClaudeProfile ?? '' });
    void getSettings().then(take, () => undefined);
    return onSettings(take);
  }, []);
  return p;
}
export const profilesFor = (p: Profiles, id: string): ClaudeProfile | null => p.items.find((x) => x.id === id) ?? p.items.find((x) => x.id === p.defaultId) ?? p.items[0] ?? null;

/** The parts of a Claude Code tab's Open that come from its profile. */
export function applyProfile(p: ClaudeProfile | null): Partial<Open> {
  if (!p) return {};
  return { profile: p.id, model: p.model || undefined, permissionMode: p.permissionMode && p.permissionMode !== 'default' ? p.permissionMode : undefined,
    flags: p.flags.length ? p.flags : undefined, prompt: p.prompt || undefined, cwd: p.cwd || undefined, title: p.id === 'default' ? undefined : p.name };
}
export const blankProfile = (n: number): ClaudeProfile => ({ id: `profile-${n}`, name: `Profile ${n}`, model: '', permissionMode: 'default', flags: [], cwd: '', prompt: '', icon: 'sparkles', color: '', connection: 'console' });
