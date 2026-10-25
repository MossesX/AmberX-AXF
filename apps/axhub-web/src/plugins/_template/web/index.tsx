import type { AxfWebLibrary } from '../../../axf/react';

export const library: AxfWebLibrary = {
  id: 'ai.amberx.axhub.example',
  label: 'Example',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-25' },
  views: { example: { title: 'Example', icon: 'package', render: () => <p className="fx-muted">An axHub web plugin.</p> } },
};
