/**
 * Diagnostics: what the runtime notices about itself — two modules registering the same asset id, setting key, or
 * settings tab / group / panel, and crashes (uncaught errors). Anything can subscribe; the alerts library turns each
 * one into an alert with `diagnosticToAlert` (engines/alerts.ts). Reports made before anyone subscribed are kept
 * (the last 100) so a library installed later still sees the conflicts from startup.
 */
import type { Diagnostic } from './engines/alerts';


export class Diagnostics {
  private readonly recentList: Diagnostic[] = [];
  private readonly listeners = new Set<(d: Diagnostic) => void>();

  report(d: Diagnostic): void {
    this.recentList.push(d);
    if (this.recentList.length > 100) this.recentList.shift();
    for (const fn of this.listeners) {
      try { fn(d); } catch { /* a listener's own error must not loop back into diagnostics */ }
    }
  }

  /** The last reports, oldest first. */
  get recent(): readonly Diagnostic[] { return this.recentList; }

  /** Listen for new reports; `replay` also delivers the kept ones first. */
  subscribe(fn: (d: Diagnostic) => void, replay = false): () => void {
    if (replay) for (const d of this.recentList) fn(d);
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}
