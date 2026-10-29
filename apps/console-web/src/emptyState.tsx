/**
 * The console's empty state (DESIGN-LANGUAGE §11): an icon, one sentence, at most one action, and the brand's faint
 * watermark when the branding package asks for one (slot `empty-state`). Plugins import it as `@console/emptyState`.
 */
import type { ReactNode } from 'react';
import { BrandWatermark, Button, Icon } from './axf/react';

export interface EmptyStateProps { icon?: string; children: ReactNode; action?: { label: string; icon?: string; onClick: () => void }; compact?: boolean }

export function EmptyState({ icon = 'info', children, action, compact }: EmptyStateProps) {
  return (
    <div className={`cx-empty is-brand-watermark ${compact ? 'cx-empty--compact' : ''}`} role="status">
      <BrandWatermark slot="empty-state" />
      <Icon name={icon} size={compact ? 18 : 24} />
      <p>{children}</p>
      {action && <Button size="sm" icon={action.icon} onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}

/** Loading placeholder (DESIGN-LANGUAGE §11: skeletons, never spinners or a bare "Loading…" for lists and panels). */
export function LoadingSkeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="cx-skeleton" aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="cx-skeleton__row" />)}
    </div>
  );
}
