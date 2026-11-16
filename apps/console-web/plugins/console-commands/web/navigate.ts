/**
 * open-url-route@1 `console-tab`, the tab's part (pure: takes the window and document, so it runs under a test).
 * The console-commands client calls it for console-command@1 op `navigate` and acks the result.
 */
/** What a navigate command (open-url-route@1 console-tab) did in this tab: the ack's `result`. */
export interface NavigateAck { opened: boolean; mode: '' | 'in-place' | 'new-tab' | 'same-tab' | 'already-here'; reason: '' | 'console-behind' | 'url-refused' | 'attempt-failed'; then?: () => void }

/** Brett's own https pages only; the server checked already, this tab checks again (a crafted message stops here). */
function ownPage(raw: string): URL | null {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && (h === 'amberxai.com' || h.endsWith('.amberxai.com')) ? u : null;
  } catch { return null; }
}

/**
 * open-url-route@1 `console-tab` in this tab. Only a tab on screen takes it (a hidden tab answers console-behind, so
 * the phone's routes go next). A console address (this console's origin) opens in place; another amberxai.com page
 * opens in a new tab, and in this tab when the browser blocks the new one. `newTab` true / false forces either. A
 * same-tab move happens in `then`, after the ack, so the caller hears first.
 */
export function navigateHere(url: string, newTab: boolean | undefined, win: Window = window, doc: Document = document): NavigateAck {
  const u = ownPage(url);
  if (!u) return { opened: false, mode: '', reason: 'url-refused' };
  if (doc.visibilityState !== 'visible') return { opened: false, mode: '', reason: 'console-behind' };
  const here = new URL(win.location.href);
  const mine = u.origin === here.origin;
  win.focus();
  if (mine && newTab !== true) {
    if (u.href === here.href) return { opened: true, mode: 'already-here', reason: '' };
    return { opened: true, mode: 'in-place', reason: '', then: () => win.location.assign(u.href) };
  }
  if (newTab !== false) {
    const w = win.open(u.href, '_blank');
    if (w) { try { w.opener = null; w.focus(); } catch { /* another origin: nothing to tidy */ } return { opened: true, mode: 'new-tab', reason: '' }; }
  }
  return { opened: true, mode: 'same-tab', reason: '', then: () => win.location.assign(u.href) };
}
