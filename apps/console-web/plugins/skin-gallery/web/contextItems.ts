/**
 * Right-click entries of the Skins plugin (rt.addContextItems):
 *   - on any view root (the canvas): Change skin here… → the scope picker on ui:<the view>, and on its plugin root
 *     → plugin:<the plugin that draws the view>;
 *   - on the banner chip: Settings… / Change… / Move.
 */
import type { AxfRuntime } from '@console/axf/core';
import { PLUGIN_ID } from './api';
import { setLink } from './link';

type Lib = { id: string; ui?: { views: { id: string }[] } };

/** The plugin that draws a view ('' for a core view). */
export function pluginOfView(rt: AxfRuntime, view: string): string {
  return (rt.libraries as unknown as Lib[]).find((l) => l.ui?.views.some((v) => v.id === view))?.id ?? '';
}

export function addContextItems(rt: AxfRuntime): void {
  rt.actions.register('skin.here', ([level]) => {
    const view = rt.getState().view;
    const plugin = pluginOfView(rt, view);
    const scope = level === 'plugin' && plugin ? `plugin:${plugin}` : view ? `ui:${view}` : 'app';
    setLink(`scope/${scope}`);
    rt.navigate('skin-gallery');
  }, { label: 'Change skin here…', params: true });
  rt.addContextItems({
    id: 'skin-gallery.here', module: PLUGIN_ID, target: 'canvas', order: 88, items: [
      { id: 'skin-gallery.here.ui', label: 'Change skin here…', icon: 'palette', action: 'skin.here:ui' },
      { id: 'skin-gallery.here.plugin', label: 'Change skin for this plugin…', icon: 'box', action: 'skin.here:plugin' },
    ],
  });
  rt.addContextItems({
    id: 'skin-gallery.chip', module: PLUGIN_ID, target: 'skin-gallery-chip', items: [
      { id: 'skin-gallery.chip.settings', label: 'Settings…', icon: 'settings', action: 'settings.open:skin-gallery' },
      { id: 'skin-gallery.chip.change', label: 'Change…', icon: 'palette', action: 'skin-gallery.focus:scope/{payload}' },
      { id: 'skin-gallery.chip.move', label: 'Move', icon: 'move', action: 'banners.settings:skin-gallery' },
    ],
  });
}
