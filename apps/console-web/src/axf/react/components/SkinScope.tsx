/**
 * <SkinScope kind="plugin" id="ai.amberx.axf.console.notes"> … </SkinScope>
 * <SkinScope kind="ui" id="home"> … </SkinScope>
 *
 * One level of the skin chain (skin-coverage@1: plugin → ui → app → global, the child overrides the parent). While the
 * level resolves to the same skin as the app, this is only a marker element (`data-axf-plugin` / `data-axf-ui`) and
 * costs nothing. When the app's look names a different skin for it (Settings → Appearance → Where, `rt.scopeSkin`),
 * the subtree is drawn like an <InterfaceScope>: the runtime's skin-scoped view (`rt.skinScoped`) becomes the runtime
 * every hook inside sees, the scope's compiled vars + re-rooted sheets (the skin's parts included) sit on the scope
 * element (`[data-fx-scope="skin-<kind>-<id>"]`), portals opened inside keep its look, and nothing leaks out.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AxfContext, useRuntime } from '../AxfProvider';
import { PortalRootContext, ScopeIdContext } from './InterfaceScope';

export type SkinScopeKind = 'ui' | 'plugin';

export function SkinScope({ kind, id, className = '', attrs = {}, children }: { kind: SkinScopeKind; id: string; className?: string; attrs?: Record<string, string>; children: ReactNode }) {
  const base = useRuntime();
  // one subscription: a change of skin at any level re-resolves the scope
  useSyncExternalStore(base.subscribe, base.getState, base.getState);
  const key = `${kind}:${id}`;
  const view = id ? base.skinScoped(key) : null;
  const ref = useRef<HTMLDivElement>(null);
  const css = view?.scopeCss() ?? '';
  const rootAttrs = view?.scopeRootAttrs() ?? {};
  const marker = { [kind === 'plugin' ? 'data-axf-plugin' : 'data-axf-ui']: id, ...attrs };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !view) return;
    view.applyTo(el);
    for (const [k, v] of Object.entries(rootAttrs)) el.setAttribute(k, v);
  });
  const scopeId = (view as unknown as { scopeId?: string } | null)?.scopeId ?? '';
  useEffect(() => () => { if (scopeId) base.dropScope(scopeId); }, [base, scopeId]);
  if (!view) return <div className={className || undefined} {...marker}>{children}</div>;
  const enter = () => base.enterScope(scopeId);
  return (
    <AxfContext.Provider value={view}>
      <ScopeIdContext.Provider value={scopeId}>
        <PortalRootContext.Provider value={ref.current}>
          <div ref={ref} className={`fx-scope ${className}`.trim()} {...marker} data-fx-scope={scopeId} data-fx-skin-scope={key} onPointerDownCapture={enter} onFocusCapture={enter} onKeyDownCapture={enter}>
            <style>{css}</style>
            {children}
          </div>
        </PortalRootContext.Provider>
      </ScopeIdContext.Provider>
    </AxfContext.Provider>
  );
}
