/**
 * xLayout's chrome host (chrome@1, embed@1): Molly as ONE app. Every app Molly frames runs with the embed@1 marker
 * (`guestUrl`: host `molly`, its banner / app menu / navigation / context menu / toolbar hidden, those functions taken),
 * so it draws none of them and sends them here as data (`chrome` messages). This module keeps each app's last bundle,
 * folds them into one model (`mergeChrome`), and puts that model into Molly's own chrome through the runtime's
 * contribution points: one application menu (a top-level menu per app), one navigation (a section per app, each entry
 * a Molly view `<app>/<item>`), one context menu (the app's items for the target right-clicked, wherever it was) and
 * the apps' toolbars (drawn by toolbars.tsx). A pick is sent back as `run` with the app's own id; the app runs it.
 *
 * Standalone, nothing here exists: apps only send chrome when a host's marker asks them to.
 */
import type { AxfRuntime } from '../../../src/axf/core';
import type { MenuItem, NavItem } from '../../../src/axf/core/types';
import type { MenuEntry } from '../../../src/axf/core/engines/windows';
import { mergeChrome, routePick, parseChromeBundle, type ChromeBundle, type UnifiedChrome, type UnifiedMenuItem } from '../../../src/axf/core/engines/chrome';
import { EMBED_MESSAGE, parseEmbedMessage, type EmbedMessage } from '../../../src/axf/core/engines/embed';
import { guestUrl, type XLayoutData } from '../../../src/axf/core/engines/xlayout';
import { MOLLY_APPS, type MollyApp } from '../../../src/molly/apps';
import { appOfView } from '../../../src/molly/host';
import { PLUGIN_ID } from './model';

/** The module the merged items are contributed under (xLayout's own menu and context entries stay under its plugin id). */
const MERGED = `${PLUGIN_ID}.merged`;
/** The action every merged item runs: `xlayout.run:<app>:<the app's own id>`. */
export const RUN_ACTION = 'xlayout.run';
/** Context targets for a right-click inside an app: `xl.<app>.<the app's target>`. */
export const ctxTarget = (app: string, target: string) => `xl.${app}.${target}`;
const badgeName = (nsid: string) => `xlayout.${nsid.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;

type Listener = () => void;

export class ChromeHost {
  private frames = new Map<string, HTMLIFrameElement>();
  private bundles = new Map<string, ChromeBundle>();
  /** the item each app last said is active, and the one we last asked it to open (so neither side echoes the other) */
  private activeOf = new Map<string, string>();
  private listeners = new Set<Listener>();
  private pushedNav = new Set<string>();
  private pushedBadges = new Set<string>();
  private unified: UnifiedChrome = mergeChrome(null, []);
  private off: (() => void)[] = [];
  rev = 0;

  constructor(private rt: AxfRuntime, private layout: () => XLayoutData) {}

  start(): void {
    const onMessage = (e: MessageEvent) => this.receive(e);
    window.addEventListener('message', onMessage);
    this.off.push(() => window.removeEventListener('message', onMessage));
    // Molly's view moved to one of an app's pages: open that page in the app
    let last = this.rt.getState().view;
    this.off.push(this.rt.subscribe(() => {
      const v = this.rt.getState().view;
      if (v === last) return;
      last = v;
      const at = v.indexOf('/');
      if (at > 0) { const app = v.slice(0, at), id = v.slice(at + 1); if (this.activeOf.get(app) !== id) { this.activeOf.set(app, id); this.post(app, { $axf: EMBED_MESSAGE, type: 'run', id }); } }
    }));
  }

  stop(): void {
    this.off.splice(0).forEach((f) => f());
    this.rt.removeAppMenuItems(MERGED);
    this.rt.removeContextItems(MERGED);
    for (const id of this.pushedNav) this.rt.removeNavSection(id);
    for (const b of this.pushedBadges) this.rt.setBadge(b, 0);
    this.pushedNav.clear(); this.pushedBadges.clear(); this.bundles.clear(); this.frames.clear();
    this.unified = mergeChrome(null, []); this.changed();
  }

  /** The address an app's frame opens: its own, with the embed@1 marker xLayout's merge rules ask for. */
  frameUrl(app: MollyApp, start: string): string {
    const l = this.layout();
    const x = l.apps.find((a) => a.id === app.id) ?? { id: app.id, label: app.label, url: app.url };
    const route = start.startsWith(app.url) ? start.slice(app.url.length).replace(/^\/?#?\/?/, '') : '';
    return guestUrl(l, { ...x, url: app.url }, 'molly', route);
  }

  /** A frame mounted (or went away): remember its window; ask for its chrome once it has loaded. */
  frame(app: string, el: HTMLIFrameElement | null): void {
    if (!el) { if (!this.frames.get(app)?.isConnected) this.frames.delete(app); return; }
    if (this.frames.get(app) === el) return;
    this.frames.set(app, el);
    el.addEventListener('load', () => this.post(app, { $axf: EMBED_MESSAGE, type: 'chrome-request' }));
  }

  subscribe(f: Listener): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private changed() { this.rev++; this.listeners.forEach((f) => f()); }

  /** The merged model as it stands. */
  chrome(): UnifiedChrome { return this.unified; }
  /** One app's last bundle (its toolbars, for the toolbar strip and the Toolbar designer). */
  bundle(app: string): ChromeBundle | null { return this.bundles.get(app) ?? null; }
  /** Apps that have sent their chrome. */
  connected(): string[] { return [...this.bundles.keys()]; }

  private appOfSource(e: MessageEvent): MollyApp | null {
    for (const [id, f] of this.frames) {
      if (f.contentWindow && e.source === f.contentWindow) {
        const app = MOLLY_APPS.find((a) => a.id === id) ?? null;
        // the frame's own origin only (a page it navigated to elsewhere can't speak for it)
        if (app && new URL(app.url).origin === e.origin) return app;
        return null;
      }
    }
    return null;
  }

  private post(app: string, msg: EmbedMessage): boolean {
    const f = this.frames.get(app); const a = MOLLY_APPS.find((x) => x.id === app);
    if (!f?.contentWindow || !a) return false;
    f.contentWindow.postMessage(msg, new URL(a.url).origin);
    return true;
  }

  private receive(e: MessageEvent): void {
    const app = this.appOfSource(e); if (!app) return;
    const m = parseEmbedMessage(e.data); if (!m) return;
    if (m.type === 'chrome') {
      // the bundle names the app by its own id; here it is the id Molly knows it by
      const b = parseChromeBundle({ ...m.chrome, app: app.id, label: app.label });
      if (!b) return;
      this.bundles.set(app.id, b);
      if (b.active) this.follow(app.id, b.active);
      this.apply();
    } else if (m.type === 'context') {
      const f = this.frames.get(app.id); if (!f) return;
      const r = f.getBoundingClientRect();
      this.rt.openContext(r.left + m.x, r.top + m.y, this.hasCtx(app.id, m.target) ? ctxTarget(app.id, m.target) : ctxTarget(app.id, 'default'), m.payload);
    } else if (m.type === 'notify') {
      this.rt.toast(m.body ?? m.title, m.level === 'error' ? 'danger' : m.level ?? 'info', m.body ? m.title : app.label);
    } else if (m.type === 'open-settings') {
      this.rt.dispatch(m.tab ? `settings.open:${m.tab}` : 'settings.open');
    }
  }

  private hasCtx(app: string, target: string): boolean { return !!this.bundles.get(app)?.context.some((t) => t.target === target); }

  /** The app moved to another page by itself: Molly's view follows when that app is the one on screen. */
  private follow(app: string, active: string): void {
    if (this.activeOf.get(app) === active) return;
    this.activeOf.set(app, active);
    const cur = appOfView(this.rt.getState().view)?.id;
    if (cur === app) this.rt.navigate(`${app}/${active}`);
  }

  /** Run a merged item: the app's own id goes back to that app, which runs it; its page comes on screen. */
  run(nsid: string): boolean {
    const { app, id } = routePick(nsid, MOLLY_APPS.map((a) => a.id));
    if (!app) return this.rt.dispatch(id);
    if (id.startsWith('nav:')) { this.activeOf.set(app, id); this.rt.navigate(`${app}/${id}`); }
    else if (appOfView(this.rt.getState().view)?.id !== app && !this.onScreen(app)) this.rt.navigate(app);
    return this.post(app, { $axf: EMBED_MESSAGE, type: 'run', id });
  }

  /** Is the app's frame showing (a pane in IDE mode, or the view on screen)? */
  onScreen(app: string): boolean { return this.frames.get(app)?.dataset.on === 'true'; }

  /** Fold every bundle and put the result into Molly's menus, navigation, context menu and badges. */
  private apply(): void {
    const l = this.layout();
    const order = l.apps.length ? l.apps.map((a) => a.id) : MOLLY_APPS.map((a) => a.id);
    const u = mergeChrome(null, [...this.bundles.values()], { order, activeApp: appOfView(this.rt.getState().view)?.id ?? null });
    this.unified = u;
    const merged = (k: keyof XLayoutData['merge']) => l.merge[k] === 'merged';
    const badges = new Set<string>();
    const conv = (items: UnifiedMenuItem[]): MenuItem[] => items.map((i) => {
      if (i.separator) return { id: i.id, separator: true };
      const out: MenuItem = { id: i.id, label: i.label };
      if (i.icon) out.icon = i.icon;
      if (i.items?.length) out.items = conv(i.items);
      else if (!i.locked) out.action = `${RUN_ACTION}:${i.id}`;
      if (i.count) { const b = badgeName(i.id); this.rt.setBadge(b, i.count); badges.add(b); out.badge = b; }
      if (typeof i.check === 'boolean') { const b = `${badgeName(i.id)}-check`; this.rt.setBadge(b, i.check ? 1 : 0); badges.add(b); out.checked = `counter:${b}`; }
      return out;
    });
    // application menu: one top-level menu per app, after Molly's own
    this.rt.removeAppMenuItems(MERGED);
    if (merged('app-menu')) u.menus.filter((m) => m.app).forEach((m, i) => {
      this.rt.addAppMenuItems({ id: `xlayout.menu.${m.app}`, module: MERGED, menu: `xl-${m.app}`, menuLabel: m.label, menuOrder: 60 + i, items: conv(m.items) });
    });
    // navigation: a section per app; each entry is a Molly view of that app's page
    const views: Record<string, { title: string; icon: string }> = {};
    const navIds = new Set<string>();
    if (merged('nav-menu')) for (const s of u.nav) {
      if (!s.app) continue;
      const items: NavItem[] = s.items.map((it) => {
        const own = it.id.slice(s.app!.length + 1);
        const view = `${s.app}/${own}`;
        views[view] = { title: it.label, icon: it.icon ?? 'box' };
        const nav: NavItem = { id: `xl.${it.id}`, label: it.label, icon: it.icon ?? 'box', view };
        if (it.badge) { const b = badgeName(it.id); this.rt.setBadge(b, it.badge); badges.add(b); nav.badge = b; }
        return nav;
      });
      const id = `xlayout.nav.${s.app}`;
      navIds.add(id);
      this.rt.setNavSection({ id, label: s.label, items });
    }
    for (const id of this.pushedNav) if (!navIds.has(id)) this.rt.removeNavSection(id);
    this.pushedNav = navIds;
    this.navViews = views;
    // context menus: right-click inside an app shows that app's items for what was clicked; right-click on Molly's own
    // chrome shows each app's general items in a submenu named after it
    this.rt.removeContextItems(MERGED);
    if (merged('context-menu')) {
      const toEntries = (items: UnifiedMenuItem[]): MenuEntry[] => conv(items).map((i) => i as MenuEntry);
      for (const [appId, b] of this.bundles) for (const t of b.context) {
        const items = u.context[t.target]?.filter((i) => i.app === appId) ?? [];
        if (items.some((i) => !i.separator)) this.rt.addContextItems({ id: `xlayout.ctx.${appId}.${t.target}`, module: MERGED, target: ctxTarget(appId, t.target), order: 10, items: toEntries(items.filter((i) => !(i.separator && i.id.includes(':sep-')))) });
      }
      const general = l.apps.map((a) => ({ a, items: (u.context.default ?? []).filter((i) => i.app === a.id && !(i.separator && i.id.includes(':sep-'))) })).filter((g) => g.items.some((i) => !i.separator));
      if (general.length) this.rt.addContextItems({ id: 'xlayout.ctx.apps', module: MERGED, target: 'default', order: 300, items: [{ id: 'xlayout.ctx.sep', separator: true }, ...general.map((g) => ({ id: `xlayout.ctx.app.${g.a.id}`, label: g.a.label, icon: g.a.icon, items: toEntries(g.items) }))] });
    }
    for (const b of this.pushedBadges) if (!badges.has(b)) this.rt.setBadge(b, 0);
    this.pushedBadges = badges;
    this.changed();
  }

  /** The Molly views of the apps' pages (`<app>/<item>`), for molly/host.ts. */
  navViews: Record<string, { title: string; icon: string }> = {};
}
