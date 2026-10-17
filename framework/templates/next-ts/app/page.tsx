import manifest from '../axf.manifest.json';
import type { AxfManifest } from '../src/axf/core';
import { loadAxfAssets } from './axf-assets';
import { AxfApp } from './AxfApp';

/** The single route: the AXF shell routes its own views (nav assets → view ids), so one page is the whole app. */
export default function Page() {
  return <AxfApp manifest={manifest as AxfManifest} assets={loadAxfAssets()} />;
}
