import type { ComponentType, ReactNode } from 'react';
import type { AxfWebLibrary } from '../../react/library';

/** {{LABEL}} — a UI kit for the web port: component overrides keyed by kind. Kinds it leaves out use the built-in AXF components. */
export interface {{CLASS}}KitComponents { Button?: ComponentType<{ children?: ReactNode; onClick?: () => void }> }
export const {{CLASS_LOWER}}Kit: { id: string; library: string; components: {{CLASS}}KitComponents } = { id: '{{SLUG}}', library: '{{P_LIBRARY}}', components: {} };

export const library: AxfWebLibrary = {
  id: '{{MODULE_ID}}',
  label: '{{LABEL}}',
  version: '{{VERSION}}',
  template: '{{TEMPLATE}}',
  register(rt) { rt.terminal.log('ui-kits', `${{{CLASS_LOWER}}Kit.id} available (wraps ${{{CLASS_LOWER}}Kit.library})`); },
};
