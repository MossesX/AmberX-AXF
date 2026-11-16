/**
 * Settings → Plugins → Open pages (open-url-route@1 on the phone). Brett, Nov 16 2026: "It sent a notification, but it
 * didn't open. I have the browser open right now." What AmberX may use to put a page Amber asks for on screen, a grant
 * button per permission (each opens Android's own settings screen), the order it will try right now, the last result,
 * and Test open. Same state and actions through the bridge (openPagesState / openPagesGrant / openPagesTest), the
 * `open-pages.*` actions, the amberx://settings/open-pages deep link and the voice phrase "test open page".
 */
import { useEffect, useState } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Container, Note } from '../../../axf/react';
import { native, type OpenPagesGrant, type OpenPagesResult, type OpenPagesState } from '../../../native';

export const OPEN_PAGES_TAB = 'open-pages';

/** The plain words for a route and a reason (the engine's REASONS, the ones the phone gives). */
export const ROUTE_WORDS: Record<string, string> = {
  'console-tab': 'the console tab on screen', overlay: 'AmberX\'s full-screen overlay', direct: 'a direct browser start',
  'full-screen-intent': 'a full-screen notice', notification: 'a tap-to-open notification', none: 'nothing',
};
export const REASON_WORDS: Record<string, string> = {
  'console-visible': 'the console tab on screen opened it', 'overlay-open': 'the overlay opened it', 'direct-start': 'AmberX started the browser',
  'screen-locked-open': 'the full-screen notice opened it', 'tap-to-open': 'only a notification went out', 'no-console': 'no console tab was on screen',
  'console-behind': 'the console tab was not on screen', 'console-stale': 'the console tab did not answer', 'overlay-off': 'Display over other apps is off',
  'overlay-not-ready': 'the toolbar was not up', 'background-start-blocked': 'Android blocked the start from the background',
  'phone-unlocked': 'Android showed the full-screen notice as a banner', 'no-full-screen-intent': 'full-screen notices are not allowed',
  'notifications-off': 'notifications are off', 'attempt-failed': 'it was tried and failed', 'nothing-left': 'every route was skipped or failed',
};

/** One line for a result: "Opened through the console tab on screen" / "Didn't open: …". */
export function resultLine(r: OpenPagesResult | null): string {
  if (!r) return 'No page opened yet.';
  const how = ROUTE_WORDS[r.route] ?? r.route;
  if (r.opened) return `Opened through ${how}.`;
  if (r.notified) return `Didn't open by itself: ${how} went out (${REASON_WORDS[(r.attempts ?? []).find((a) => !a.opened)?.reason ?? ''] ?? 'Android held the start back'}).`;
  return `Didn't open: ${REASON_WORDS[r.reason] ?? r.reason}.`;
}

const GRANTS: { which: OpenPagesGrant; key: 'overlay' | 'fullScreenIntent' | 'notifications'; label: string; why: string }[] = [
  { which: 'overlay', key: 'overlay', label: 'Display over other apps', why: 'Lets AmberX open a page over whatever is on screen, Chrome included.' },
  { which: 'full-screen', key: 'fullScreenIntent', label: 'Full-screen notices', why: 'Opens the page over the lock screen when the phone is locked.' },
  { which: 'notifications', key: 'notifications', label: 'Notifications', why: 'The last resort: a tap-to-open notification.' },
];

export function OpenPagesPanel() {
  const [st, setSt] = useState<OpenPagesState | null>(null);
  const [said, setSaid] = useState('');
  const load = () => native.openPagesState().then(setSt, () => setSaid('AmberX could not read its permissions.'));
  useEffect(() => {
    void load();
    // back from Android's settings screen: read again
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);
  const grant = (which: OpenPagesGrant) => native.openPagesGrant({ which }).then((r) => { if (!r.opened) setSaid(`Couldn't open Android's settings (${r.error ?? 'unknown'}).`); });
  const test = () => { setSaid('Opening the Dev Console…'); return native.openPagesTest().then((r) => { setSaid(resultLine(r)); void load(); }, (e) => setSaid(`Test open failed: ${String((e as Error)?.message ?? e)}`)); };
  if (!st) return said ? <Note tone="warning">{said}</Note> : <Note tone="info">Reading permissions…</Note>;
  return (
    <div className="fx-stack" data-axf-target="panel:open-pages">
      {said && <Note tone="info">{said}</Note>}
      <Container title="What AmberX may use" icon="shield">
        {GRANTS.map((g) => (
          <div key={g.which} className="fx-stack" data-axf-target={`row:open-pages-${g.which}`}>
            <Note tone={st[g.key] ? 'success' : 'warning'}>{g.label}: {st[g.key] ? 'on' : 'off'}. {g.why}</Note>
            {!st[g.key] && <Button icon="settings" onClick={() => void grant(g.which)}>Turn on {g.label}</Button>}
          </div>
        ))}
        <Note tone={st.consoleSignedIn ? 'success' : 'info'}>Console: {st.consoleSignedIn ? 'signed in, so a console tab on screen opens pages first.' : 'not signed in on this phone, so the console tab is skipped.'}</Note>
      </Container>
      <Container title="Right now" icon="list">
        <Note tone="info">Order: {st.order.length ? st.order.map((r) => ROUTE_WORDS[r] ?? r).join(' → ') : 'nothing can open a page'}.</Note>
        <Note tone={st.last?.opened ? 'success' : st.last ? 'warning' : 'info'}>Last: {resultLine(st.last)}</Note>
        <Button icon="external" onClick={() => void test()}>Test open</Button>
        <Button icon="refresh" onClick={() => void load()}>Refresh</Button>
      </Container>
    </div>
  );
}

/** Settings → Plugins → Open pages (a settings panel, not a page). */
export const openPagesPanel = { id: 'amberx.open-pages', tab: OPEN_PAGES_TAB, title: 'Open pages', icon: 'external', order: 0, render: () => <OpenPagesPanel /> };

/** The deep link for this screen (also the console-control address view:settings/tab:settings.tabs=open-pages). */
export const OPEN_PAGES_LINK = 'amberx://settings/open-pages';

/**
 * Actions (voice, commands, the hub through the bridge's own tools): open-pages.open, open-pages.state (says the
 * permissions and the last route), open-pages.test[:<url>], open-pages.grant:<overlay|full-screen|notifications>.
 * amberx://settings/<tab> opens that settings tab.
 */
export function registerOpenPages(rt: AxfRuntime) {
  const open = () => { rt.dispatch(`settings.open:${OPEN_PAGES_TAB}`); };
  rt.actions.register('open-pages.open', open, { label: 'Open Settings → Open pages' });
  rt.actions.register('open-pages.state', () => {
    void native.openPagesState().then((st) => {
      const off = GRANTS.filter((g) => !st[g.key]).map((g) => g.label);
      rt.toast(`${off.length ? `Off: ${off.join(', ')}.` : 'Everything AmberX needs to open pages is on.'} Last: ${resultLine(st.last)}`, off.length ? 'warning' : 'info', 'Open pages');
    }, () => undefined);
  }, { label: 'Say how AmberX opens pages' });
  rt.actions.register('open-pages.test', (args) => {
    const url = args.length ? args.join(':') : undefined;
    void native.openPagesTest(url ? { url } : undefined).then((r) => rt.toast(resultLine(r), r.opened ? 'info' : 'warning', 'Test open'), (e) => rt.toast(`Test open failed: ${String((e as Error)?.message ?? e)}`, 'warning', 'Test open'));
  }, { label: 'Test open a page' });
  rt.actions.register('open-pages.grant', (args) => {
    const which = (GRANTS.find((g) => g.which === args[0])?.which ?? 'overlay') as OpenPagesGrant;
    void native.openPagesGrant({ which }).catch(() => undefined);
  }, { label: 'Turn on what AmberX needs to open pages' });
  void native.addListener('deeplink', ({ url }) => {
    const m = /^amberx:\/\/settings\/([a-z0-9-]+)/i.exec(url);
    if (m) rt.dispatch(`settings.open:${m[1]!.toLowerCase()}`);
  }).catch(() => undefined);
}
