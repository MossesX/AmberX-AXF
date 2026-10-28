/**
 * `@console/plugins` for AmberX: lets the Dev Console's own plugins (AI assistant, Agent manager) run here unchanged.
 * Their server routes are reached through AmberX's server (`/api/console/plugins/<folder>/…`), which forwards them to the
 * console with the console token it holds; the page itself holds no token (the hub session signs the request).
 * Hub admins only (AmberX's server refuses everyone else). Generic: it never names a plugin.
 */
import { authHeaders, createApiClient, STANDARD_MESSAGES, type ApiClient, type TokenStore } from '../axf/libs/apiclient';

/** No token in the page: AmberX's server adds the console token. */
const noToken: TokenStore = { key: '', event: 'amberx:console-token', get: () => '', set: () => {}, clear: () => {}, subscribe: () => () => {} };

function pluginUrl(folder: string, path: string): string { return `/api/console/plugins/${folder}/${path.replace(/^\/+/, '')}`; }

/** Where a 401/403 sends people: the hub sign-in (AmberX admins only). */
export function tokenHome(): string { return 'sign in at the hub as an admin'; }

export async function pluginFetch(folder: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(pluginUrl(folder, path), { ...init, headers: authHeaders(noToken, init), cache: 'no-store', credentials: 'same-origin' });
}

export function pluginApi(folder: string, label: string, opts: { tokenHome?: string; unavailable?: string } = {}): ApiClient {
  let client: ApiClient | null = null;
  const c = (): ApiClient => (client ??= createApiClient({
    url: (path) => pluginUrl(folder, path),
    tokens: noToken,
    fetch: (url, init) => fetch(url, { ...init, credentials: 'same-origin' }),
    messages: {
      unauthorized: STANDARD_MESSAGES.unauthorized(opts.tokenHome ?? tokenHome()),
      unavailable: opts.unavailable ?? `${label} isn't reachable: the console is down, the plugin is off there, or this AmberX server has no console token.`,
    },
  }));
  return {
    fetch: (path, init) => c().fetch(path, init),
    call: (path, init) => c().call(path, init),
    post: (path, body) => c().post(path, body),
    put: (path, body) => c().put(path, body),
    patch: (path, body) => c().patch(path, body),
    del: (path) => c().del(path),
    download: (path, name, init) => c().download(path, name, init),
  } as ApiClient;
}
