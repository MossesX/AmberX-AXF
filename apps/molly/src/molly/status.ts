import type { AxfRuntime } from '../axf/core';

/**
 * Molly's live status sources (menu-item@2 `status: source:<id>`, flagship skin s8). The Molly menu's Status sub-menu
 * and its Appearance rows draw them as a small icon beside the entry: green when healthy, amber when it needs you,
 * red when broken, pulsing while it works; hovering the icon says what it means.
 *
 *   source:hub          axHub connection (lib-hub, mounted in App.tsx: useHubMenuStatus)
 *   source:molly.look   the shared look on axHub: synced, connecting, sign-in needed, unreachable
 *   source:molly.skin   which skin is on (or the app's own look)
 *   source:molly.role   who you are in Molly (role)
 */
export const MOLLY_STATUS = { look: 'molly.look', skin: 'molly.skin', role: 'molly.role' } as const;

type Reading = { state: 'on' | 'off' | 'busy' | 'warn' | 'unknown'; text: string; icon?: string };

export function lookStatus(rt: AxfRuntime): Reading {
  const a = rt.getState().appearance;
  if (!a) return { state: 'unknown', text: 'No look source', icon: 'palette' };
  switch (a.status) {
    case 'ready': return { state: 'on', text: 'Synced with axHub', icon: 'palette' };
    case 'connecting': return { state: 'busy', text: 'Connecting to axHub', icon: 'palette' };
    case 'unauthorized': return { state: 'warn', text: 'Sign in to axHub', icon: 'palette' };
    default: return { state: 'off', text: 'axHub unreachable, retrying', icon: 'palette' };
  }
}

export function skinStatus(rt: AxfRuntime): Reading {
  const s = rt.appLook()?.skin;
  if (!s?.use || !s.id) return { state: 'unknown', text: "Molly's own look", icon: 'layers' };
  const name = rt.skinList().find((k) => k.id === s.id)?.name ?? s.id;
  return { state: 'on', text: name, icon: 'layers' };
}

export function roleStatus(rt: AxfRuntime): Reading {
  const role = rt.getState().role;
  return role ? { state: 'on', text: role, icon: 'user' } : { state: 'warn', text: 'No role', icon: 'user' };
}

/** Register Molly's sources; each re-reads on every state change and redraws open menus only when its reading changes. */
export function installStatusSources(rt: AxfRuntime): () => void {
  const push = () => {
    rt.setMenuStatus(MOLLY_STATUS.look, lookStatus(rt), 'molly');
    rt.setMenuStatus(MOLLY_STATUS.skin, skinStatus(rt), 'molly');
    rt.setMenuStatus(MOLLY_STATUS.role, roleStatus(rt), 'molly');
  };
  push();
  return rt.subscribe(push);
}
