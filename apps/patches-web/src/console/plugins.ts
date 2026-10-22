/** `@console/plugins` in Patches: a banner plugin's own server routes, through Patches' console proxy. */
import { createApiClient, STANDARD_MESSAGES, authHeaders, type ApiClient } from '../axf/libs/apiclient';
import { patchesTokens } from './tokens';

/** Fired when the plugin list changes (Patches' plugin switches). */
export const PLUGINS_CHANGED = 'patches:plugins-changed';

const pluginUrl = (folder: string, path: string) => `/api/console/plugins/${folder}/${path.replace(/^\/+/, '')}`;

/** Where a plugin's 401 message sends people. */
export function tokenHome(): string { return 'sign in to axHub, or Settings → Patches → App token'; }

/** Fetch for a plugin's own server routes (in the console), through Patches. */
export async function pluginFetch(folder: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(pluginUrl(folder, path), { ...init, headers: authHeaders(patchesTokens, init), cache: 'no-store', credentials: 'same-origin' });
}

/** JSON client for a plugin's own server routes (in the console), through Patches; same messages as in the console. */
export function pluginApi(folder: string, label: string, opts: { tokenHome?: string; unavailable?: string } = {}): ApiClient {
  return createApiClient({
    url: (path) => pluginUrl(folder, path),
    tokens: patchesTokens,
    fetch: (url, init) => fetch(url, { ...init, credentials: 'same-origin' }),
    messages: {
      unauthorized: STANDARD_MESSAGES.unauthorized(opts.tokenHome ?? tokenHome()),
      unavailable: opts.unavailable ?? `${label} is off in the Dev Console, or Patches can't reach the console (PATCHES_CONSOLE_TOKEN).`,
    },
  });
}
