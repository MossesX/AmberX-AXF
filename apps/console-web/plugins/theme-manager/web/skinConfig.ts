/*
 * Skin config (skin-config@1) for the console: the REST routes (server/__init__.py, skins.mjs config is the writer)
 * published as the web capability `axf.skin-config@1` on `globalThis.__axfWebServices`, so the framework's Skin config
 * panel (libs/settings/SkinConfigPanel.tsx) reaches it without naming this plugin, and the console actions
 * `skin.config.*` that voice (AmberX through console_action), menus and the panel share.
 */
import type { AxfRuntime } from '@console/axf/core';
import { call, post, put } from './api';

export const SKIN_CONFIG_SERVICE = 'axf.skin-config@1';
const services = () => ((globalThis as { __axfWebServices?: Record<string, unknown> }).__axfWebServices ??= {});
const enc = encodeURIComponent;

export const skinConfigService = {
  version: 1,
  tree: () => call<unknown>('skin-config/tree'),
  get: (app: string) => call<unknown>(`skin-config/${enc(app)}`),
  set: (app: string, path: string, mode: 'allow' | 'lock' | 'ask' | 'inherit') => post<unknown>(`skin-config/${enc(app)}/set`, { path, mode }),
  depth: (app: string, type: string, value: number | 'default', limit?: string) => post<unknown>(`skin-config/${enc(app)}/depth`, { type, value, ...(limit ? { limit } : {}) }),
  mode: (app: string, mode: 'allow' | 'lock' | 'ask') => post<unknown>(`skin-config/${enc(app)}/mode`, { mode }),
  reset: (app: string) => post<unknown>(`skin-config/${enc(app)}/reset`),
  put: (app: string, config: unknown) => put<unknown>(`skin-config/${enc(app)}`, { config }),
  saveDefault: (app: string) => post<unknown>(`skin-config/${enc(app)}/default`),
  brief: (app: string, wish = '') => call<unknown>(`skin-config/${enc(app)}/brief?wish=${enc(wish)}`),
  make: (app: string, wish = '') => post<unknown>(`skin-config/${enc(app)}/make`, { wish }),
  made: (app: string) => call<{ items: unknown[] }>(`skin-config/${enc(app)}/made`),
};

/** Publish the capability and register the actions (the panel's buttons and voice run the same ones). */
export function registerSkinConfig(rt: AxfRuntime): void {
  services()[SKIN_CONFIG_SERVICE] = skinConfigService;
  const app = () => rt.manifest.app.id;
  const done = (p: Promise<unknown>, ok: string) => p.then(() => { rt.toast(ok, 'success'); globalThis.dispatchEvent?.(new CustomEvent('axf:skin-config')); }, (e: Error) => rt.toast(e.message, 'danger'));
  const on = (id: string, fn: (args: string[]) => void, label: string, params = false) => rt.actions.register(id, fn, { label, ...(params ? { params: true } : {}) });
  on('skin.config.open', () => rt.dispatch('settings.open:skin-config'), 'Open the skin config');
  on('skin.config.allow', ([path = '']) => void done(skinConfigService.set(app(), path, 'allow'), `The AI may change ${path}.`), 'Let the AI change a part of the skin', true);
  on('skin.config.lock', ([path = '']) => void done(skinConfigService.set(app(), path, 'lock'), `${path} is locked.`), 'Lock a part of the skin', true);
  on('skin.config.ask', ([path = '']) => void done(skinConfigService.set(app(), path, 'ask'), `The AI asks before changing ${path}.`), 'Ask before the AI changes a part of the skin', true);
  on('skin.config.inherit', ([path = '']) => void done(skinConfigService.set(app(), path, 'inherit'), `${path} follows its parent again.`), 'Clear a part’s own setting', true);
  on('skin.config.depth', ([type = '', v = 'default']) => void done(skinConfigService.depth(app(), type, v === 'default' ? 'default' : Number(v)), `${type}: ${v} level${v === '1' ? '' : 's'}.`), 'Set how deep the AI may build a menu', true);
  on('skin.config.reset', () => void done(skinConfigService.reset(app()), 'Skin config reset: the AI may change everything.'), 'Reset the skin config');
  on('skin.config.default', () => void done(skinConfigService.saveDefault(app()), 'The current look is saved as the Default skin.'), 'Save the current look as the Default skin');
  on('skin.config.make', ([wish = '']) => void done(skinConfigService.make(app(), wish), 'Making a skin with AI. It shows under Skins made by AI when it is done.'), 'Make a skin with AI under the skin config', true);
}
