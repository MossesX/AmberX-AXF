/**
 * Patches' stand-ins for the Dev Console modules its banner plugins import (`@console/...`, vite.config.ts). The plugins
 * are baked from apps/console-web/plugins (scripts/bake-banner-plugins.mjs); their server parts stay in the console and
 * are reached through Patches' own server (`/api/console/...`), which holds the console token. The browser needs no
 * console token: Patches' API takes the hub session (or Patches' own app token, the same one src/api.ts uses).
 */
import { createTokenStore } from '../axf/libs/apiclient';

/** Patches' app token (local dev / wall off), the same localStorage key src/api.ts reads. */
export const patchesTokens = createTokenStore({ key: 'patches-web:token' });
