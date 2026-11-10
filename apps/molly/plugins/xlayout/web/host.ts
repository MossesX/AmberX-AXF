/**
 * xLayout's chrome host: Molly as ONE app. Every app mounts natively in Molly (molly/native.tsx, shell-surface@1), so
 * its screens, menus, actions and settings reach Molly's one menu and nav through its surface (One shell, `axf.shell@1`)
 * and nothing is taken over from a frame any more (molly-one-shell s11 removed the embed@1 chrome take-over and the
 * frames with it).
 *
 * What is left is the seam xLayout's toolbars and settings read: `chrome()` (the merged chrome model, empty: no app sends
 * its chrome as frame messages now), `run(<app>:<id>)` (an app's own action, run in that app natively) and `connected()`
 * (the apps whose native surface has loaded).
 */
import type { AxfRuntime } from '../../../src/axf/core';
import { mergeChrome, routePick, type UnifiedChrome } from '../../../src/axf/core/engines/chrome';
import type { XLayoutData } from '../../../src/axf/core/engines/xlayout';
import { MOLLY_APPS } from '../../../src/molly/apps';
import { nativeApps, nativeRev, nativeState, onNative, openNative } from '../../../src/molly/native';

/** The action an app item runs: `xlayout.run:<app>:<the app's own id>`. */
export const RUN_ACTION = 'xlayout.run';

export class ChromeHost {
  private readonly empty: UnifiedChrome = mergeChrome(null, []);
  /** Molly views an app's pages added (none: an app's screens are Molly views through its native surface). */
  readonly navViews: Record<string, { title: string; icon?: string }> = {};

  /** `layout`: the xlayout in force (kept in the signature; the native host doesn't need it). */
  constructor(private rt: AxfRuntime, _layout?: () => XLayoutData) {}

  start(): void { /* nothing to listen to: native surfaces register with One shell themselves */ }
  stop(): void { /* idem */ }

  subscribe(f: () => void): () => void { return onNative(f); }
  get rev(): number { return nativeRev(); }

  chrome(): UnifiedChrome { return this.empty; }

  /** The apps that have joined Molly natively (their surface loaded). */
  connected(): string[] { return nativeApps().filter((a) => nativeState(a.id)?.state === 'ready').map((a) => a.id); }

  /** Run an app's own item (`<app>:<id>`) in that app; an id without an app is Molly's own action. */
  run(nsid: string): boolean {
    const { app, id } = routePick(nsid, MOLLY_APPS.map((a) => a.id));
    if (!app) return this.rt.dispatch(id);
    if (id.startsWith('nav:')) return openNative(this.rt, app, { kind: 'screen', id: id.slice(4) });
    return openNative(this.rt, app, { kind: 'action', id });
  }
}
