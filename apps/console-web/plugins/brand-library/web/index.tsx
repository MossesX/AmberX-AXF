/**
 * Brand library console plugin (ai.amberx.axf.console.brand-library): browse the framework's brand library
 * (framework/brand-library: 250 logos, 250 animated logos, 100 icon packs, 50 branding packages) in nav → Plugins →
 * Brand library. The library is served by this plugin's server part (never bundled); the view is in BrandLibrary.tsx.
 * Actions: brand-library.open.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { restoreApplied } from './apply';
import { BrandLibrary } from './BrandLibrary';
import { Preview } from './Preview';
import { FOLDER, ID, VIEW } from './model';
import './brand-library.css';
import { appMenu } from './menu';

function Page() {
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Design &amp; branding</p><h1>Brand library</h1><p className="fx-muted">Every logo, animated logo, icon pack and branding package the framework ships, ready to preview and apply.</p></div></header>
      <BrandLibrary renderPreview={(p) => <Preview {...p} />} />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Brand library',
  version: '0.1.0',
  appMenu,
  register(rt) {
    void restoreApplied(rt);
    rt.actions.register('brand-library.open', () => rt.navigate(VIEW), { label: 'Open the brand library' });
  },
  views: { [VIEW]: { title: 'Brand library', icon: 'star', keywords: ['brand', 'logo', 'logos', 'animated', 'icon pack', 'icons', 'branding', 'mark'], render: () => <Page /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Brand library', icon: 'star', view: VIEW }] },
  settingsTabs: [{ id: FOLDER, label: 'Brand library', icon: 'star', order: 34, parent: 'plugins' }],
  settingsPanels: [{ id: 'brand-library.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
