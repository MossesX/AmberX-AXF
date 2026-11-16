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
import { native, type OpenPagesGrant, type OpenPagesState } from '../../../native';
import { GRANTS, OPEN_PAGES_TAB, ROUTE_WORDS, resultLine } from './open-pages-core';

export { OPEN_PAGES_TAB } from './open-pages-core';


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
