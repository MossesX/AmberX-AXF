import { LayoutToolbar, useScreenLayout, type AxfWebLibrary } from '../../../axf/react';

const PLUGIN_ID = 'ai.amberx.amberx.example';
const VIEW = 'example';
/** Three layouts per screen (screen-layouts@1, Brett Nov 4 2026): rename to what fits this screen; mirrored in plugin.json "screens". */
const LAYOUTS = [
  { id: 'compact', label: 'Compact', icon: 'list', description: 'Tight rows, more on one screen.' },
  { id: 'standard', label: 'Standard', icon: 'layout', description: 'The everyday arrangement.' },
  { id: 'spacious', label: 'Spacious', icon: 'grid', description: 'Room around every block, big targets.' },
];

function ExampleView() {
  const screen = useScreenLayout(VIEW);
  return (
    <div className="fx-stack" {...screen.rootProps}>
      <header className="fx-pagehead"><div {...screen.headProps}><h1>Example</h1></div></header>
      <LayoutToolbar view={VIEW} plugin={PLUGIN_ID} />
      <p className="fx-muted">An AmberX plugin.{screen.layout === 'compact' ? ' (compact)' : screen.layout === 'spacious' ? ' (spacious)' : ''}</p>
    </div>
  );
}

export const library: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Example',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-25' },
  views: { [VIEW]: { title: 'Example', icon: 'package', render: () => <ExampleView />, layouts: LAYOUTS, defaultLayout: 'standard' } },
};
