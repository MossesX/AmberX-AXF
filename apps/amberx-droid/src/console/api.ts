/**
 * `@console/api` for AmberX: the slice of the console's API module that console plugins installed here may import.
 * The page holds no console token (AmberX's server adds it when it forwards `/api/console/…`), so `consoleTokens` is the
 * same empty store `@console/plugins` signs with. Add an export here only when a plugin that targets amberx-droid needs it.
 */
import { noToken } from './plugins';

export const consoleTokens = noToken;
export const getToken = () => consoleTokens.get();
export const TOKEN_CHANGED = consoleTokens.event;
