/** Console plugins targeting this app (vite.config.ts → consolePluginsModule). */
declare module 'virtual:amberx-console-plugins' {
  import type { AxfWebLibrary } from '../axf/react';
  const plugins: { folder: string; manifest: { id?: string; name?: string; version?: string }; library?: AxfWebLibrary }[];
  export default plugins;
}
