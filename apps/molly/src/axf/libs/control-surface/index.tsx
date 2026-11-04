/**
 * Control surface library (`ai.amberx.axf.control-surface`, web): puts any AXF app on the API, MCP and CLI (build
 * apps-control-surface, Brett Nov 3 2026: "Put EVERY app on the API, MCP and CLI"). Install it and a Claude session
 * can say `app_show {app: '<this app>', target: 'to-dos'}` and the open app goes there; `apps_list` shows it online.
 *
 *   import { controlSurfaceLibrary } from './axf/libs/control-surface';
 *   installLibraries(rt, [settingsLibrary, controlSurfaceLibrary, ...]);
 *
 * or, with the app's own transport (AmberX forwards through its server) or extra items (Molly's apps as screens):
 *
 *   createControlSurfaceLibrary({ transport: { fetch: (path, init) => fetch(`/api/console/plugins/<broker plugin>/${path}`, init) } })
 *
 * The client (client.ts, no React) starts in `register` and stays for the page's life; Settings → Plugins → Remote
 * control switches it off for this device and the note per command. No UI of its own beyond those settings.
 */
import type { AxfWebLibrary } from '../../react/library';
import { CONTROL_SURFACE_ID, CONTROL_SURFACE_KEYS, installControlSurface, type ControlSurfaceOptions } from './client';

export * from './client';

export const CONTROL_SURFACE_TAB = 'control-surface';

/** The library for one app. `opts.keys` defaults to CONTROL_SURFACE_KEYS (the settings below switch them). */
export function createControlSurfaceLibrary(opts: ControlSurfaceOptions = {}): AxfWebLibrary {
  const keys = opts.keys ?? CONTROL_SURFACE_KEYS;
  return {
    id: CONTROL_SURFACE_ID,
    label: 'Remote control',
    version: '0.1.0',
    builtWith: { model: 'fable', builtAt: '2026-11-04' },
    opens: false,
    register(rt) { installControlSurface(rt, opts); },
    settingsTabs: [{ id: CONTROL_SURFACE_TAB, label: 'Remote control', icon: 'radio', order: 92, parent: 'plugins', description: 'Let Claude sessions, the API and the CLI open screens, dialogs and settings in this app' }],
    settings: [{
      id: 'control-surface.prefs', label: 'Remote control', icon: 'radio', tab: CONTROL_SURFACE_TAB, order: 10,
      description: 'When Brett tells Amber to open something in this app, the open app goes there. Opening only navigates; an action that changes data keeps its own permission.',
      settings: [
        { key: keys.on, label: 'Let Claude sessions move this app', kind: 'toggle', default: true, scope: 'device', description: 'Off: this device stops listening; commands go to your other open copies of the app.' },
        { key: keys.toast, label: 'Show a note for each command', kind: 'toggle', default: true, scope: 'device', description: 'A short note saying who opened what.' },
      ],
    }],
    help: {
      entries: [
        { target: CONTROL_SURFACE_TAB, title: 'Remote control', text: 'Lets a Claude session (Amber), the REST API or the CLI open screens, dialogs and settings tabs in this app and run its actions. Opening only moves the screen; an action that changes data still needs its own permission.' },
        { target: keys.on, title: 'Let Claude sessions move this app', text: 'On: this device listens for commands and goes where they say. Off: it stops listening, and commands go to your other open copies of the app.' },
        { target: keys.toast, title: 'Show a note for each command', text: 'Shows a short note each time a command moves this app, saying who asked and what opened.' },
      ],
      intros: [],
    },
  };
}

/** The library with the defaults: the app's manifest id, the console's broker with the browser's own session. */
export const controlSurfaceLibrary: AxfWebLibrary = createControlSurfaceLibrary();
