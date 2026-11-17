/**
 * Hidden assets by voice in AmberX (hidden-assets@1; Brett, Nov 17 2026): the phrases the console understands
 * (framework core/engines/console-control-voice.mjs: "hide the toolbar", "unhide the menu bar", "what's hidden",
 * "unhide everything") run the same actions here, on AmberX's own chrome: chrome.hide / chrome.unhide / chrome.hidden /
 * chrome.unhideAll (react/components/ChromeContext.tsx). Anything else is left to the other routers.
 */
import type { AxfRuntime } from '../../../axf/core';
import { voiceIntent } from '../../../axf/core/engines/console-control-voice.mjs';

const ACTIONS = new Set(['chrome.hide', 'chrome.unhide', 'chrome.hidden', 'chrome.unhideAll']);

/** What to say after the action ran. */
function reply(action: string, value: string, count: number): string {
  const what = ({ toolbar: 'the toolbar', 'app-menu': 'the menu bar', 'nav-menu': 'the navigation', banner: 'the banner' } as Record<string, string>)[value.split(':')[0] ?? ''] ?? 'it';
  if (action === 'chrome.hide') return `Hid ${what}. Say "what's hidden" to bring it back.`;
  if (action === 'chrome.unhide') return `${what.replace(/^./, (c) => c.toUpperCase())} is back.`;
  if (action === 'chrome.unhideAll') return 'Everything is back.';
  return count ? `${count} hidden. Here is the list.` : 'Nothing is hidden.';
}

/** A sentence → one of the hidden-assets actions, run on this app; null when it isn't one. */
export async function hiddenAssetsVoice(rt: AxfRuntime, heard: string, speak: (text: string) => Promise<unknown> | unknown): Promise<{ did: string; ok: boolean } | null> {
  const intent = voiceIntent(heard) as { verb: string; address?: string; value?: unknown } | null;
  const action = intent?.verb === 'press' && intent.address?.startsWith('function:') ? intent.address.slice('function:'.length) : '';
  if (!ACTIONS.has(action)) return null;
  const value = typeof intent?.value === 'string' ? intent.value : '';
  const ok = rt.dispatch(value ? `${action}:${value}` : action) !== false;
  const did = ok ? reply(action, value, rt.hiddenCount()) : "Couldn't do that here.";
  await speak(did);
  return { did, ok };
}
