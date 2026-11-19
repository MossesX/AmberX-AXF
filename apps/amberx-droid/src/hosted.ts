/**
 * Where the AmberX web app is served from. The Android shell loads the hosted copy (capacitor.config.json
 * `server.url`), which sits under the hub's cookie domain so one hub sign-in covers the app and the hub. Pure: no DOM,
 * no Capacitor (tested by test.mjs).
 */
export const HOSTED_URL = 'https://amberx.amberxai.com';

/** True when `page` is an https page under the same parent domain as the hub (e.g. amberx.amberxai.com + axhub.amberxai.com). */
export function sharesHubSite(page: string, hub: string): boolean {
  try {
    const p = new URL(page), h = new URL(hub);
    if (p.protocol !== 'https:' || h.protocol !== 'https:') return false;
    const parent = h.hostname.split('.').slice(-2).join('.');
    return parent.includes('.') && (p.hostname === parent || p.hostname.endsWith(`.${parent}`));
  } catch { return false; }
}
