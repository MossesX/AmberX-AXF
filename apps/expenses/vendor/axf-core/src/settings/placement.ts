/**
 * @file Where a module's settings open (settings-placement@1 in AmberX-AXF, Brett Nov 4 2026: "I should be able to
 * select in every screen where its settings pops up"): a pop-up dialog, a side panel (left or right), a bottom sheet,
 * inside the screen, the full page or a floating window. One pick per module (screen) and an app default.
 *
 * The Expense Tracker runs on the vendored @axf/core 0.0.25 line, so this is the same contract drawn with MUI rather
 * than the AXF engines: the same six placements and the same words (`framework/core/engines/settingsplacement-rules.mjs`
 * in AmberX-AXF), persisted per user in the kv namespace `settings-placement`, modelled on `toolbar/prefs.ts` (lazy
 * async load, optimistic writes, server snapshot pinned to the defaults so the server and hydrating renders agree).
 */
"use client";

import * as React from "react";

import { defaultKv } from "../persist/client";
import type { KvTransport } from "../persist/client";

export const PLACEMENT_CHOICES = ["dialog", "panel-left", "panel-right", "sheet", "inside", "page", "window"] as const;
export type PlacementChoice = (typeof PLACEMENT_CHOICES)[number];

export const CHOICE_LABELS: Readonly<Record<PlacementChoice, string>> = {
  dialog: "Pop-up dialog",
  "panel-left": "Side panel, left",
  "panel-right": "Side panel, right",
  sheet: "Bottom sheet",
  inside: "Inside the screen",
  page: "Full page",
  window: "Floating window"
};

/** What settings open in when nobody picked: the dialog the app always had. */
export const SYSTEM_DEFAULT: PlacementChoice = "dialog";

/** The kv namespace. One document per user. */
export const PLACEMENT_NS = "settings-placement";
const DOC_VERSION = 1;

export interface PlacementDoc {
  /** the app default, when someone set one */
  readonly default?: PlacementChoice;
  /** module id → its own pick */
  readonly modules: Readonly<Record<string, PlacementChoice>>;
}
const EMPTY_DOC: PlacementDoc = Object.freeze({ modules: Object.freeze({}) });

export const isChoice = (x: unknown): x is PlacementChoice => typeof x === "string" && (PLACEMENT_CHOICES as readonly string[]).includes(x);

/** The pick in force for a module and where it came from (its own, the app default, or the system default). */
export function resolvePlacement(moduleId: string, doc: PlacementDoc): { choice: PlacementChoice; from: "module" | "app" | "system" } {
  const own = doc.modules[moduleId];
  if (own) return { choice: own, from: "module" };
  if (doc.default) return { choice: doc.default, from: "app" };
  return { choice: SYSTEM_DEFAULT, from: "system" };
}

type Listener = () => void;

export class PlacementStore {
  #state: PlacementDoc = EMPTY_DOC;
  #transport: KvTransport | null;
  #loadStarted = false;
  readonly #listeners = new Set<Listener>();

  constructor(transport?: KvTransport) {
    this.#transport = transport ?? null;
  }

  #kv(): KvTransport {
    this.#transport ??= defaultKv();
    return this.#transport;
  }

  #ensureLoaded(): void {
    if (this.#loadStarted || typeof window === "undefined") return;
    this.#loadStarted = true;
    void this.#kv()
      .read(PLACEMENT_NS)
      .then((doc) => {
        if (!doc || doc.v !== DOC_VERSION) return;
        const raw = doc.modules;
        const modules: Record<string, PlacementChoice> = {};
        if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
          for (const [id, c] of Object.entries(raw as Record<string, unknown>)) if (isChoice(c)) modules[id] = c;
        }
        this.#state = { ...(isChoice(doc.default) ? { default: doc.default } : {}), modules };
        for (const fn of this.#listeners) fn();
      })
      .catch(() => {
        // No route, no document: the defaults stand. Overwritten on the next edit only.
      });
  }

  subscribe = (fn: Listener): (() => void) => {
    this.#ensureLoaded();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): PlacementDoc => {
    this.#ensureLoaded();
    return this.#state;
  };

  /** Always the empty document (server render = the defaults). */
  getServerState = (): PlacementDoc => EMPTY_DOC;

  /** One module's pick; null = back to the app default. */
  setModule(moduleId: string, choice: PlacementChoice | null): void {
    this.#ensureLoaded();
    const modules = { ...this.#state.modules };
    if (choice === null) {
      if (!(moduleId in modules)) return;
      delete modules[moduleId];
    } else {
      if (!isChoice(choice) || modules[moduleId] === choice) return;
      modules[moduleId] = choice;
    }
    this.#write({ ...this.#state, modules });
  }

  /** The app default; null = the system default (a dialog). */
  setDefault(choice: PlacementChoice | null): void {
    this.#ensureLoaded();
    if ((choice ?? undefined) === this.#state.default) return;
    const { default: _old, ...rest } = this.#state;
    this.#write(choice && isChoice(choice) ? { ...rest, default: choice } : rest);
  }

  #write(next: PlacementDoc): void {
    this.#state = next;
    for (const fn of this.#listeners) fn();
    void this.#kv()
      .write(PLACEMENT_NS, { v: DOC_VERSION, ...(next.default ? { default: next.default } : {}), modules: { ...next.modules } })
      .catch(() => {
        // Route down: the change stays in memory for the session.
      });
  }
}

/** The process-wide placement document. */
export const settingsPlacement = new PlacementStore();

/** Live placements inside a component; safe under SSR. */
export function useSettingsPlacement(): PlacementDoc {
  return React.useSyncExternalStore(settingsPlacement.subscribe, settingsPlacement.getState, settingsPlacement.getServerState);
}
