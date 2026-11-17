/**
 * `@console/api` for AmberX: the token parts of the Dev Console's api module that console plugins installed here import.
 * The page holds no console token (AmberX's server adds it when it forwards a plugin call), so the store is always
 * empty and a request goes out with the hub session alone. Generic: it never names a plugin.
 */
import type { TokenStore } from '../axf/libs/apiclient';

/** No token in the page: AmberX's server adds the console token. */
export const consoleTokens: TokenStore = { key: '', event: 'amberx:console-token', get: () => '', set: () => {}, clear: () => {}, subscribe: () => () => {} };
export const getToken = () => consoleTokens.get();
export const setToken = (t: string) => consoleTokens.set(t);
