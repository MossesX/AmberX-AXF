/**
 * Action engine — the cross-application command bus. Menus, toolbars,
 * context menus and shortcuts never call code directly; they reference an
 * action spec like "file.save" or "swap:color-theme:next". Any AmberX AXF app can
 * bind its own handler to a standard action id, so assets stay portable.
 */
import type { AxfRuntime } from '../runtime';

export interface ActionContext {
  runtime: AxfRuntime;
  /** optional payload, e.g. from a context-menu target */
  payload?: string;
}

export type ActionHandler = (args: string[], ctx: ActionContext) => void;

export interface ActionMeta {
  label: string;
  requires?: string;
  /** true for the framework's no-op stubs (apps are expected to override) */
  stub?: boolean;
  /** true when the action needs arguments (`swap:<type>:<id>`); search lists only argument-free actions */
  params?: boolean;
  /** false keeps an argument-free action out of search */
  searchable?: boolean;
}

export class ActionBus {
  private handlers = new Map<string, { fn: ActionHandler; meta: ActionMeta }>();

  register(id: string, fn: ActionHandler, meta: ActionMeta): () => void {
    this.handlers.set(id, { fn, meta });
    return () => this.handlers.delete(id);
  }

  static parse(spec: string): { id: string; args: string[] } {
    const [id = '', ...args] = spec.split(':');
    return { id, args };
  }

  get(id: string) {
    return this.handlers.get(id);
  }

  list(): { id: string; meta: ActionMeta }[] {
    return [...this.handlers.entries()].map(([id, h]) => ({ id, meta: h.meta }));
  }

  dispatch(spec: string, ctx: ActionContext): boolean {
    const resolved = ctx.payload ? spec.replace(/\{payload\}/g, ctx.payload) : spec;
    const { id, args } = ActionBus.parse(resolved);
    const h = this.handlers.get(id);
    if (!h) {
      ctx.runtime.toast(`No handler is registered for "${id}".`, 'warning', 'Unknown action');
      return false;
    }
    if (h.meta.requires && !ctx.runtime.can(h.meta.requires)) {
      ctx.runtime.toast(`Your role can't run "${h.meta.label}".`, 'danger', 'Permission denied');
      return false;
    }
    h.fn(args, ctx);
    return true;
  }
}

/**
 * The standard action vocabulary shared by every AmberX AXF app. The framework
 * registers stubs for these; apps override the ones they implement.
 */
export const STANDARD_ACTIONS: Record<string, ActionMeta> = {
  'file.new': { label: 'New file' },
  'file.open': { label: 'Open…' },
  'file.save': { label: 'Save', requires: 'files.write' },
  'file.export': { label: 'Export', requires: 'files.write' },
  'edit.undo': { label: 'Undo' },
  'edit.redo': { label: 'Redo' },
  'edit.cut': { label: 'Cut' },
  'edit.copy': { label: 'Copy' },
  'edit.paste': { label: 'Paste' },
  'edit.delete': { label: 'Delete', requires: 'files.write' },
  'run.build': { label: 'Build', requires: 'dev.tools' },
  'run.deploy': { label: 'Deploy', requires: 'dev.deploy' },
  'dev.console': { label: 'Developer console', requires: 'dev.tools' },
  'help.about': { label: 'About' },
  'help.docs': { label: 'Documentation' },
  'view.shortcuts': { label: 'Keyboard shortcuts' },
};
