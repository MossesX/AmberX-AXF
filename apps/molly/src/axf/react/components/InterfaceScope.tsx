/**
 * <InterfaceScope id="tab-2" interface="midnight"> … </InterfaceScope>
 * Draws its subtree under another interface (interface@1): the runtime's scoped view (`rt.scoped`) becomes the
 * runtime every hook inside sees, the scope's compiled vars + re-rooted sheets sit on the scope element
 * (`[data-fx-scope]`), and portals opened from inside (search results, menus) mount in the scope's own portal root
 * (`usePortalRoot`) so they keep its look. Nothing leaks out: the page's `:root` and the app's own settings are
 * untouched, and a swap or setting written from inside goes to the shared runtime, never to the scope's interface.
 * Unknown interface or a bad id → the children render unscoped (and the terminal gets one warning).
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AxfContext, useRuntime } from '../AxfProvider';

const PortalRootContext = createContext<HTMLElement | null>(null);
const ScopeIdContext = createContext<string>('');

/** The interface scope this subtree is drawn in ('' = the app itself). Hosts draw only what belongs to their scope. */
export function useScopeId(): string { return useContext(ScopeIdContext); }

/** Where a portal from this subtree mounts: the nearest interface scope's root, else document.body. */
export function usePortalRoot(): HTMLElement {
  return useContext(PortalRootContext) ?? document.body;
}

export function InterfaceScope({ id, interface: interfaceId, className = '', children }: { id: string; interface: string; className?: string; children: ReactNode }) {
  const base = useRuntime();
  const view = base.scoped(id, interfaceId);
  const ref = useRef<HTMLDivElement>(null);
  // one subscription keeps the scope's vars in step with hot swaps in the app or the interface's assets
  useSyncExternalStore(base.subscribe, base.getState, base.getState);
  const css = view?.scopeCss() ?? '';
  const attrs = view?.scopeRootAttrs() ?? {};
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !view) return;
    view.applyTo(el);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  });
  useEffect(() => () => base.dropScope(id), [base, id]);
  useEffect(() => { if (!view) base.terminal.warn('interfaces', `InterfaceScope "${id}": no interface "${interfaceId}" in this app, drawing it unscoped`); }, [base, id, interfaceId, view]);
  if (!view) return <>{children}</>;
  const enter = () => base.enterScope(id);
  return (
    <AxfContext.Provider value={view}>
      <ScopeIdContext.Provider value={id}>
        <PortalRootContext.Provider value={ref.current}>
          <div ref={ref} className={`fx-scope ${className}`.trim()} data-fx-scope={id} data-fx-interface={interfaceId} onPointerDownCapture={enter} onFocusCapture={enter} onKeyDownCapture={enter}>
            <style>{css}</style>
            {children}
          </div>
        </PortalRootContext.Provider>
      </ScopeIdContext.Provider>
    </AxfContext.Provider>
  );
}
