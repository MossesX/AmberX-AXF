import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { embedUrl } from '../../../src/axf/core/engines/embed';
import { BANNER_STRIP_MESSAGE, bannerStripUrl, FRAME_BANNERS_SLOT, parseBannerStripMessage, Segmented, Switch, useRuntime, type BannerStripEntry, type BannerStripMessage } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { mollyApp } from '../../../src/molly/apps';
import { appOfView, mollyHooks, onMollyHooks, setMollyHook } from '../../../src/molly/host';
import helpPack from '../help.json';
import './banners.css';

/**
 * Banners (Molly plugin, its own folder): Molly's one banner region. The Dev Console draws its own live banners in a
 * strip (its banner-strip page, framework/react/bannerStrip.ts) that sits in Molly's app.frame.banners slot: every
 * banner plugin the console has, with its Banner settings and colours, shows here with no change on Molly's side.
 * While something the strip opened (a dialog, a menu) is up, the strip covers Molly's whole window; a banner item that
 * opens a console view opens it in the console's own frame and brings that frame on screen. The apps Molly frames hide
 * their own banner (embed@1; xLayout's merge rules do it when xLayout is on, this plugin when it isn't).
 * Molly's top banner is picked, not copied (Brett, Nov 4 2026: "Make Molly's top banner asset the same as console"):
 * `molly-banners.top` = `console` (default) has the strip draw the console's whole banner bar (the banner asset in force,
 * its logo and every widget its plugins attach) at the very top, and Molly leaves its own bar out; `molly` keeps Molly's
 * own bar with the console's widgets in the strip under it. One switch in Settings → Plugins → Banners.
 * Settings → Plugins → Banners. Removed, Molly shows no banners and the frames draw their own again.
 */

export const PLUGIN_ID = 'ai.amberx.axf.molly.banners';
const FOLDER = 'banners';
const TAB = 'molly-banners';
const K = { show: 'molly-banners.show', top: 'molly-banners.top' } as const;
/** Whose banner bar is Molly's top banner: the source app's (its banner asset, drawn by its strip) or Molly's own. */
type Top = 'console' | 'molly';
const topOf = (v: unknown): Top => (v === 'molly' ? 'molly' : 'console');
/** Page-wide slot above Molly's application menu, where the strip sits while it draws the top banner. */
const HEAD_SLOT = 'app.frame.head';
/** Set on <html> while the strip draws the top banner, so Molly leaves its own banner bar out (banners.css). */
const TOP_ATTR = 'mollyTopBanner';
/** The app whose banners Molly shows (an app id from molly/apps.ts). */
const SOURCE = 'console';

/* ---------- what the strip told us (shared by the strip and the settings tab) ---------- */

const strip = { banners: [] as BannerStripEntry[], frame: null as HTMLIFrameElement | null, rev: 0 };
const subs = new Set<() => void>();
const changed = () => { strip.rev++; subs.forEach((f) => f()); };
const useStrip = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => strip.rev, () => strip.rev);

function toStrip(m: BannerStripMessage): boolean {
  const app = mollyApp(SOURCE);
  if (!strip.frame?.contentWindow || !app) return false;
  strip.frame.contentWindow.postMessage(m, new URL(app.url).origin);
  return true;
}

/** A banner item opened a console view: bring the console on screen (the console's own frame opens the view). */
function showSource(rt: AxfRuntime): void {
  if (appOfView(rt.getState().view)?.id === SOURCE) return;
  if (document.querySelector(`.molly-frame[data-app="${SOURCE}"][data-on="true"]`)) return; // in a pane already
  rt.navigate(SOURCE);
}

function useSetting<T>(key: string, fallback: T): T {
  const rt = useRuntime();
  const v = useSyncExternalStore((f) => rt.settings.onChange(key, f), () => rt.settings.get(key), () => rt.settings.get(key));
  return (v ?? fallback) as T;
}

/* ---------- the strip ---------- */

/** The strip, in the slot the top-banner setting puts it in (one frame on screen: the other slot draws nothing). */
function Strip({ at }: { at: Top }) {
  const top = topOf(useSetting<string>(K.top, 'console'));
  return top === at ? <StripFrame top={top} /> : null;
}

function StripFrame({ top }: { top: Top }) {
  const rt = useRuntime();
  const show = useSetting<boolean>(K.show, true);
  const [bar, setBar] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const [cover, setCover] = useState(false);
  const app = mollyApp(SOURCE);
  const src = app ? bannerStripUrl(app.url, 'molly') : '';

  useEffect(() => {
    if (!app) return;
    strip.frame = frame.current;
    const origin = new URL(app.url).origin;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== origin) return;
      const m = parseBannerStripMessage(e.data); if (!m) return;
      if (m.type === 'size') { setHeight(m.height); setCover(m.overlay); setBar(m.bar === true); if ((m.bar === true) !== (top === 'console')) toStrip({ $axf: BANNER_STRIP_MESSAGE, type: 'bar', on: top === 'console' }); }
      else if (m.type === 'open') showSource(rt);
      else if (m.type === 'banners') { strip.banners = m.banners; changed(); }
    };
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); if (strip.frame === frame.current) strip.frame = null; };
  }, [app, rt, top]);

  // the strip is up: ask it for the whole banner bar (or only the widgets) whenever the pick changes
  useEffect(() => { toStrip({ $axf: BANNER_STRIP_MESSAGE, type: 'bar', on: top === 'console' }); }, [top]);

  // Molly's own banner bar steps aside only once the strip really draws the source's bar (its banner hidden there, or an
  // older strip that can't draw it = Molly keeps its own)
  const own = !(show && top === 'console' && bar && height > 0);
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (own) delete html.dataset[TOP_ATTR]; else html.dataset[TOP_ATTR] = 'source';
    return () => { delete html.dataset[TOP_ATTR]; };
  }, [own]);

  // covering the window: tell the strip where it sits, so its banners stay put under the dialog it opened
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    toStrip(cover && r ? { $axf: BANNER_STRIP_MESSAGE, type: 'inset', top: r.top, left: r.left, width: r.width } : { $axf: BANNER_STRIP_MESSAGE, type: 'inset', top: 0, left: 0, width: 0 });
  }, [cover]);

  if (!app) return null;
  return (
    <div ref={box} className="axp-banners-strip" data-axf-help-id="molly-banners-strip" data-top={top} data-on={show && height > 0 ? 'true' : 'false'} style={{ height: show ? height : 0 }}>
      <iframe
        ref={frame}
        title={`${app.label} banners`}
        className="axp-banners-strip__frame"
        data-cover={cover ? 'true' : 'false'}
        src={src}
        allow="clipboard-read; clipboard-write; microphone; fullscreen; autoplay"
        style={cover ? undefined : { height: show ? height : 0 }}
      />
    </div>
  );
}

/* ---------- Settings → Plugins → Banners ---------- */

function ShowPanel() {
  const rt = useRuntime();
  const show = useSetting<boolean>(K.show, true);
  const top = topOf(useSetting<string>(K.top, 'console'));
  const label = mollyApp(SOURCE)?.label ?? SOURCE;
  return (
    <div className="fx-stack" data-axf-help-id="molly-banners-show">
      <Switch label="Show the banners" hint={`The ${label}'s live banners at the top of Molly. Their look, colours and order come from each banner's own Banner settings (right-click a banner).`} checked={show} onChange={(v) => rt.settings.set(K.show, v)} />
      <div className="fx-stack" data-axf-help-id="molly-banners-top">
        <Segmented<Top> label="Top banner" value={top} onChange={(v) => rt.settings.set(K.top, v)} options={[{ value: 'console', label: `${label}'s banner`, icon: 'terminal' }, { value: 'molly', label: 'Molly\u2019s own', icon: 'home' }]} />
        <p className="fx-muted">{top === 'console' ? `Molly's top banner is the ${label}'s: the same banner asset, logo, chips and badges. Change the banner asset once and both follow.` : `Molly draws its own banner bar; the ${label}'s chips and badges sit in the strip under it.`}</p>
      </div>
    </div>
  );
}

function EachPanel() {
  useStrip();
  const list = strip.banners;
  if (!list.length) return <p className="fx-muted">The banner list shows here once the {mollyApp(SOURCE)?.label ?? SOURCE}'s banners have loaded (sign in to it first).</p>;
  return (
    <div className="fx-stack" data-axf-help-id="molly-banners-each">
      {list.map((b) => (
        <Switch key={b.id} label={b.label} hint="Off = hidden inside Molly (the banner's own “Hide it inside a host app”)." checked={!b.hidden} onChange={(on) => { toStrip({ $axf: BANNER_STRIP_MESSAGE, type: 'set-hidden', id: b.id, hidden: !on }); }} />
      ))}
    </div>
  );
}

function LifecyclePanel() {
  return (
    <div className="fx-stack">
      <p className="fx-muted">This plugin's code is all in apps/molly/plugins/{FOLDER}. Install or remove it (Molly then shows no banners and the apps draw their own):</p>
      <pre className="axp-banners-code">{`node apps/molly/plugins/${FOLDER}/install.mjs\nnode apps/molly/plugins/${FOLDER}/uninstall.mjs --all`}</pre>
    </div>
  );
}

/* ---------- the library ---------- */

let started = false;

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Banners',
  version: '0.1.0',
  provides: ['slot:app.frame.banners', `slot:${HEAD_SLOT}`, 'settings-tab:molly-banners'],
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    if (started) return; // StrictMode runs this twice in development
    started = true;
    rt.actions.register('molly-banners.toggle', () => rt.settings.set(K.show, rt.settings.get(K.show) === false), { label: 'Banners on / off' });
    rt.actions.register('molly-banners.top', () => rt.settings.set(K.top, topOf(rt.settings.get(K.top)) === 'console' ? 'molly' : 'console'), { label: 'Top banner: console\u2019s / Molly\u2019s own' });
    // One banner on screen: the frames Molly opens hide their own banner. xLayout's merge rules already do it (and own the
    // hook while on); without xLayout, this plugin marks them itself.
    const mark = () => { if (!mollyHooks().frameUrl) setMollyHook(PLUGIN_ID, 'frameUrl', (_a, start) => embedUrl(start, 'molly', ['banner'])); };
    mark();
    onMollyHooks(mark);
  },
  slots: {
    // top banner = the console's: the strip sits above Molly's application menu, where Molly's own bar was
    [HEAD_SLOT]: [{ id: 'molly-banners.top', order: 0, render: () => <Strip at="console" /> }],
    [FRAME_BANNERS_SLOT]: [{ id: 'molly-banners.strip', order: 0, render: () => <Strip at="molly" /> }],
  },
  settingsTabs: [{ id: TAB, label: 'Banners', icon: 'bell', order: 30, parent: 'plugins', description: 'The Dev Console’s live banners at the top of Molly: show them, and pick which.' }],
  settingsPanels: [
    { id: 'molly-banners.show', tab: TAB, title: 'Banner strip', icon: 'bell', order: 10, render: () => <ShowPanel /> },
    { id: 'molly-banners.each', tab: TAB, title: 'Each banner', icon: 'eye', order: 20, render: () => <EachPanel /> },
    { id: 'molly-banners.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
  appMenu: [
    { id: 'molly-banners.view', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 30, items: [
      { id: 'molly-banners.toggle', label: 'Banners', icon: 'bell', action: 'molly-banners.toggle', checked: `setting:${K.show}` },
      { id: 'molly-banners.settings', label: 'Banner settings…', icon: 'settings', action: `settings.open:${TAB}` },
    ] },
  ],
};

