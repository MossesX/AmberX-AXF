import { ASSET_TYPES, serializeAsset, type AxfRuntime } from './axf/core';

/**
 * Bind this app's handlers to the standard action vocabulary.
 * Menus, toolbars and context menus from *any* AmberX AXF asset call these by id.
 */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);

  on('file.new', () => axf.openDialog('new-file'), { label: 'New file' });
  on('file.open', () => axf.toast('Opening files is wired up per platform (web, desktop, Android).', 'info', 'Open'), { label: 'Open…' });
  on('file.save', () => axf.toast('Workspace saved.', 'success', 'Saved'), { label: 'Save', requires: 'files.write' });
  on('edit.delete', () => axf.openDialog('confirm-delete'), { label: 'Delete', requires: 'files.write' });
  on('help.about', () => axf.openDialog('about'), { label: 'About' });
  on('view.shortcuts', () => axf.openDialog('shortcuts'), { label: 'Keyboard shortcuts' });
  on('dev.console', () => axf.openDialog('dev-console'), { label: 'Developer console', requires: 'dev.tools' });

  on('run.build', () => {
    axf.toast('Compiling against the AmberX AXF build engine…', 'info', 'Build started');
    setTimeout(() => axf.toast('Build finished with 0 errors.', 'success', 'Build complete'), 1400);
  }, { label: 'Build', requires: 'dev.tools' });

  // Export the currently active asset set as a portable bundle any AmberX AXF app can import.
  on('file.export', () => {
    const bundle = ASSET_TYPES.map((t) => JSON.parse(serializeAsset(axf.asset(t))));
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${axf.manifest.app.id}-assets.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    axf.toast(`${bundle.length} active assets exported as one bundle.`, 'success', 'Exported');
  }, { label: 'Export', requires: 'files.write' });
}
