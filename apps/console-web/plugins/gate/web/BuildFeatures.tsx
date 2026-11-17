/**
 * A build's features in a Gate row's detail, each with the Shipped features Open button. The button comes through the
 * `feature.open` slot, which the plugin providing service:axf.shipped-features@1 fills (never its folder name): none
 * installed = nothing drawn. Before the build lands the buttons are disabled with the reason "not landed yet"; once it
 * has landed each opens its feature's screen in the live console. The same component serves the Pending features tab.
 */
import { Slot, useSlotFilled } from '@console/axf/react';

export const FEATURE_OPEN_SLOT = 'feature.open';

export function BuildFeatures({ build, landed }: { build: string; landed: boolean }) {
  const filled = useSlotFilled(FEATURE_OPEN_SLOT);
  if (!build || !filled) return null;
  return (
    <div className="axp-gate__stat" data-help="gate-build-features">
      <span className="axp-gate__label">Features</span>
      <Slot name={FEATURE_OPEN_SLOT} props={{ build, landed }} />
    </div>
  );
}
