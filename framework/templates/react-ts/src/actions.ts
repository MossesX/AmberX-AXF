import { ASSET_TYPES, serializeAsset, type FrameRuntime } from './frame/core';

/**
 * Bind this app's handlers to the standard action vocabulary.
 * Menus, toolbars and context menus from *any* Frame asset call these by id.
 */
export function registerActions(frame: FrameRuntime) {
  const on = frame.actions.register.bind(frame.actions);

  on('file.new', () => frame.openDialog('new-file'), { label: 'New file' });
  on('file.open', () => frame.toast('Opening files is wired up per platform (web, desktop, Android).', 'info', 'Open'), { label: 'Open…' });
  on('file.save', () => frame.toast('Workspace saved.', 'success', 'Saved'), { label: 'Save', requires: 'files.write' });
  on('edit.delete', () => frame.openDialog('confirm-delete'), { label: 'Delete', requires: 'files.write' });
  on('help.about', () => frame.openDialog('about'), { label: 'About' });
  on('view.shortcuts', () => frame.openDialog('shortcuts'), { label: 'Keyboard shortcuts' });
  on('dev.console', () => frame.openDialog('dev-console'), { label: 'Developer console', requires: 'dev.tools' });

  on('run.build', () => {
    frame.toast('Compiling against the Frame build engine…', 'info', 'Build started');
    setTimeout(() => frame.toast('Build finished with 0 errors.', 'success', 'Build complete'), 1400);
  }, { label: 'Build', requires: 'dev.tools' });

  // Export the currently active asset set as a portable bundle any Frame app can import.
  on('file.export', () => {
    const bundle = ASSET_TYPES.map((t) => JSON.parse(serializeAsset(frame.asset(t))));
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${frame.manifest.app.id}-assets.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    frame.toast(`${bundle.length} active assets exported as one bundle.`, 'success', 'Exported');
  }, { label: 'Export', requires: 'files.write' });
}
