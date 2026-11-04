/**
 * @file The shell-owned settings surface — ONE surface for every owner's rows, drawn where the owner's placement says
 * (settings/placement.ts, Brett Nov 4 2026: "select in every screen where its settings pops up"):
 *
 *   dialog        a MUI Dialog (what the app always had)
 *   panel-left/right  a MUI Drawer from that side
 *   sheet         a MUI Drawer from the bottom
 *   page          the Dialog full screen
 *   window        a floating, draggable Paper (non-modal)
 *   inside        rendered by ModuleHost at the top of the screen itself (<InlineSettings>); nothing here
 *
 * Mounted once by `AppShell`, beside `ContextMenuRoot`: chrome each surface has to remember is chrome that is missing
 * somewhere. It renders whichever owner `settingsUi` says is open, from that owner's DECLARED rows — so a module's
 * settings surface exists the moment its decl does, with no per-module dialog file. Every surface starts with the
 * "Pops up in" row (settings-placement@1: every settings interface declares where it pops up).
 *
 * Controls per kind: `switch` → `Switch`, `number` → bounded `TextField` (`type="number"`), `text` → `TextField`,
 * `select` → `TextField select`. All MUI (`no-hand-rolled-ui.md` rule 0); colours ride the bridged theme.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Drawer from "@mui/material/Drawer";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { registry } from "../registry";
import { token } from "../theme/apply";
import type { SettingRow, SettingValue } from "./decl";
import { settingsGates, useSettingsGates } from "./gates";
import { CHOICE_LABELS, PLACEMENT_CHOICES, resolvePlacement, settingsPlacement, useSettingsPlacement, type PlacementChoice } from "./placement";
import { settings, settingsUi } from "./store";

function RowControl({
  row,
  value,
  onChange
}: {
  row: SettingRow;
  value: SettingValue;
  onChange: (v: SettingValue) => void;
}) {
  switch (row.kind) {
    case "switch":
      return (
        <Switch
          size="small"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          slotProps={{ input: { "aria-label": row.label } }}
        />
      );
    case "number":
      return (
        <TextField
          size="small"
          type="number"
          value={String(value)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            const lo = row.min ?? -Infinity;
            const hi = row.max ?? Infinity;
            onChange(Math.min(hi, Math.max(lo, n)));
          }}
          slotProps={{
            input: { sx: { width: 96 } },
            htmlInput: { min: row.min, max: row.max, step: row.step ?? 1, "aria-label": row.label }
          }}
        />
      );
    case "select":
      return (
        <TextField
          size="small"
          select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          sx={{ minWidth: 160 }}
          slotProps={{ htmlInput: { "aria-label": row.label } }}
        >
          {(row.options ?? []).map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      );
    case "text":
      return (
        <TextField
          size="small"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          sx={{ minWidth: 200 }}
          slotProps={{ htmlInput: { "aria-label": row.label } }}
        />
      );
  }
}

/**
 * "Pops up in": the top row of every settings surface (settings-placement@1). Picks where THIS module's settings open,
 * or (with "for every screen" on) the app default. "Use the app default" takes the module back to the default.
 */
export function PopsUpInRow({ moduleId }: { moduleId: string }) {
  const doc = useSettingsPlacement();
  const [forAll, setForAll] = React.useState(false);
  const own = doc.modules[moduleId];
  const r = resolvePlacement(moduleId, doc);
  const appDefault = doc.default;
  const value = forAll ? (appDefault ?? "default") : (own ?? "default");
  const onChange = (v: string) => {
    const choice = v === "default" ? null : (v as PlacementChoice);
    if (forAll) settingsPlacement.setDefault(choice);
    else settingsPlacement.setModule(moduleId, choice);
  };
  const fallbackLabel = forAll ? "A pop-up dialog" : CHOICE_LABELS[resolvePlacement("", { modules: {}, default: appDefault }).choice];
  return (
    <Box data-axf-settings-placement={moduleId} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, pb: 1.5, mb: 1.5, borderBottom: `1px solid ${token("border")}` }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>Pops up in</Typography>
      <TextField size="small" select value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 200 }} slotProps={{ htmlInput: { "aria-label": "Pops up in" } }}>
        <MenuItem value="default">{forAll ? "Use the default (a pop-up dialog)" : `Use the app default (${fallbackLabel.toLowerCase()})`}</MenuItem>
        {PLACEMENT_CHOICES.map((c) => (
          <MenuItem key={c} value={c}>
            {CHOICE_LABELS[c]}
          </MenuItem>
        ))}
      </TextField>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Switch size="small" checked={forAll} onChange={(e) => setForAll(e.target.checked)} slotProps={{ input: { "aria-label": "For every screen" } }} />
        <Typography sx={{ fontSize: 12, color: token("dim") }}>for every screen</Typography>
      </Box>
      <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
        {own ? "set for this screen" : r.from === "app" ? "the app default" : "the default"} · {CHOICE_LABELS[r.choice].toLowerCase()}
      </Typography>
    </Box>
  );
}

/** The rows of one owner's settings (the body every surface shares). */
export function SettingsBody({ openFor }: { openFor: string }) {
  const store = settings.get(openFor);
  const values = React.useSyncExternalStore(
    store ? store.subscribe : (fn: () => void) => (void fn, () => {}),
    store ? store.getState : () => null,
    store ? store.getServerState : () => null
  );
  // Re-render when a gate is registered or announces a change, so a row that
  // becomes this person's (a sign-in, a promotion) appears without a remount
  // and one that stops being theirs leaves.
  useSettingsGates();
  // A row naming a gate that does not hold is not this person's to set. An
  // ungated row, and a row whose gate nobody registered, both show — see
  // `gates.ts` on why the default is open.
  const rows = (store?.decl.rows ?? []).filter((row) => !row.gate || settingsGates.holds(row.gate));
  return (
    <>
      <PopsUpInRow moduleId={openFor} />
      {!store || !values ? (
        <Typography sx={{ fontSize: 13, color: token("dim") }}>This surface declares no settings.</Typography>
      ) : rows.length === 0 ? (
        // Distinct from the sentence above, and the difference is the whole
        // point: this surface HAS settings, none of them are yours. Saying
        // "declares no settings" here would send somebody hunting for a
        // dialog that is already open.
        <Typography sx={{ fontSize: 13, color: token("dim") }}>No settings here are yours to change.</Typography>
      ) : (
        <Stack spacing={1.5}>
          {rows.map((row) => (
            <Box key={row.key} sx={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "space-between" }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{row.label}</Typography>
                <Typography sx={{ fontSize: 11.5, color: token("dim") }}>{row.hint}</Typography>
              </Box>
              <RowControl row={row} value={values[row.key]} onChange={(v) => store.set(row.key, v)} />
            </Box>
          ))}
        </Stack>
      )}
    </>
  );
}

/** Reset + Done, the same on every surface. */
export function SettingsActions({ openFor, onClose }: { openFor: string; onClose: () => void }) {
  const store = settings.get(openFor);
  return (
    <>
      {store && (
        <Button size="small" color="inherit" onClick={() => store.reset()}>
          Reset to defaults
        </Button>
      )}
      <Button size="small" variant="contained" onClick={onClose}>
        Done
      </Button>
    </>
  );
}

/** The title every surface shows: the module registry first, then the decl's own, then the bare id. */
export function settingsTitle(openFor: string): string {
  return registry.module(openFor)?.title ?? settings.get(openFor)?.decl.title ?? openFor;
}

/** A floating, draggable, non-modal window (placement `window`). Drag it by its title. */
function FloatingSettings({ openFor, onClose }: { openFor: string; onClose: () => void }) {
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const drag = React.useRef<{ dx: number; dy: number } | null>(null);
  const title = settingsTitle(openFor);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget.parentElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  return (
    <Paper
      elevation={8}
      role="dialog"
      aria-label={`${title} settings`}
      data-axf-settings-window={openFor}
      sx={{
        position: "fixed",
        zIndex: (t) => t.zIndex.modal - 1,
        width: "min(440px, calc(100vw - 16px))",
        maxHeight: "min(640px, calc(100vh - 16px))",
        display: "flex",
        flexDirection: "column",
        ...(pos ? { left: pos.x, top: pos.y } : { right: 8, bottom: 8 })
      }}
    >
      <Box onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} sx={{ cursor: "move", touchAction: "none", userSelect: "none", px: 2, py: 1, borderBottom: `1px solid ${token("border")}`, display: "flex", alignItems: "center", gap: 1 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{title} settings</Typography>
        <Typography component="span" sx={{ fontSize: 12, color: token("dim"), fontFamily: token("mono") }}>{openFor}</Typography>
      </Box>
      <DialogContent sx={{ overflow: "auto" }}>
        <SettingsBody openFor={openFor} />
      </DialogContent>
      <DialogActions>
        <SettingsActions openFor={openFor} onClose={onClose} />
      </DialogActions>
    </Paper>
  );
}

export function SettingsDialog() {
  const openFor = React.useSyncExternalStore(settingsUi.subscribe, settingsUi.openFor, settingsUi.serverOpenFor);
  const doc = useSettingsPlacement();
  if (!openFor) return null;
  const { choice } = resolvePlacement(openFor, doc);
  const title = settingsTitle(openFor);
  const close = () => settingsUi.close();
  const head = (
    <>
      {title} settings
      <Typography component="span" sx={{ ml: 1, fontSize: 12, color: token("dim"), fontFamily: token("mono") }}>
        {openFor}
      </Typography>
    </>
  );
  // inside: ModuleHost draws it at the top of the screen (InlineSettings); nothing floats
  if (choice === "inside") return null;
  if (choice === "window") return <FloatingSettings openFor={openFor} onClose={close} />;
  if (choice === "panel-left" || choice === "panel-right" || choice === "sheet") {
    const anchor = choice === "sheet" ? "bottom" : choice === "panel-left" ? "left" : "right";
    return (
      <Drawer open anchor={anchor} onClose={close} aria-label={`${title} settings`} data-axf-settings-placement-surface={choice}
        slotProps={{ paper: { sx: anchor === "bottom" ? { maxHeight: "75vh", borderTopLeftRadius: 12, borderTopRightRadius: 12 } : { width: "min(440px, 92vw)" } } }}>
        <DialogTitle sx={{ pb: 1 }}>{head}</DialogTitle>
        <DialogContent dividers sx={{ flex: 1 }}>
          <SettingsBody openFor={openFor} />
        </DialogContent>
        <DialogActions>
          <SettingsActions openFor={openFor} onClose={close} />
        </DialogActions>
      </Drawer>
    );
  }
  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth fullScreen={choice === "page"} aria-label={`${title} settings`} data-axf-settings-placement-surface={choice}>
      <DialogTitle sx={{ pb: 1 }}>{head}</DialogTitle>
      <DialogContent dividers>
        <SettingsBody openFor={openFor} />
      </DialogContent>
      <DialogActions>
        <SettingsActions openFor={openFor} onClose={close} />
      </DialogActions>
    </Dialog>
  );
}

/** Placement `inside`: the settings as a section at the top of the module's own screen (ModuleHost renders it). */
export function InlineSettings({ moduleId }: { moduleId: string }) {
  const openFor = React.useSyncExternalStore(settingsUi.subscribe, settingsUi.openFor, settingsUi.serverOpenFor);
  const doc = useSettingsPlacement();
  if (openFor !== moduleId || resolvePlacement(moduleId, doc).choice !== "inside") return null;
  const title = settingsTitle(moduleId);
  return (
    <Paper variant="outlined" role="region" aria-label={`${title} settings`} data-axf-settings-inline={moduleId} sx={{ m: 1, p: 2, flex: "0 0 auto" }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 1.5 }}>{title} settings</Typography>
      <SettingsBody openFor={moduleId} />
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>
        <SettingsActions openFor={moduleId} onClose={() => settingsUi.close()} />
      </Box>
    </Paper>
  );
}
