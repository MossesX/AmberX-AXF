/** The Skins plugin's settings (GET / POST /api/plugins/skin-gallery/settings; the CLI, MCP and voice use the same route). */
import { pluginFetch } from '@console/plugins';

export interface SkinsSettings { bannerChip: boolean; defaultScope: string; undoSeconds: number; previewView: 'desktop' | 'phone' }
export const SETTINGS_DEFAULTS: SkinsSettings = { bannerChip: true, defaultScope: 'app', undoSeconds: 10, previewView: 'desktop' };

let cur: SkinsSettings = { ...SETTINGS_DEFAULTS };
const subs = new Set<(s: SkinsSettings) => void>();
const emit = () => { for (const f of subs) f(cur); };

export const settings = () => cur;
export const defaultScope = () => cur.defaultScope || 'app';
export function onSettings(f: (s: SkinsSettings) => void): () => void { subs.add(f); return () => { subs.delete(f); }; }

export async function loadSettings(): Promise<SkinsSettings> {
  try {
    const r = await pluginFetch('skin-gallery', 'settings');
    const j = await r.json() as { ok: boolean; result?: SkinsSettings };
    if (j.ok && j.result) { cur = { ...SETTINGS_DEFAULTS, ...j.result }; emit(); }
  } catch { /* the defaults stay */ }
  return cur;
}

export async function saveSettings(patch: Partial<SkinsSettings>): Promise<SkinsSettings> {
  const r = await pluginFetch('skin-gallery', 'settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const j = await r.json() as { ok: boolean; result?: SkinsSettings; error?: string };
  if (!j.ok || !j.result) throw new Error(j.error ?? `HTTP ${r.status}`);
  cur = { ...SETTINGS_DEFAULTS, ...j.result }; emit();
  return cur;
}
