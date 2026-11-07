"use client";

/**
 * @file Collapsible settings sections for the MUI shell (owner, Nov 7 2026, build
 * settings-sections-everywhere). Same contract as the framework's FoldPanel: fold
 * state per device under `axf.fold:`, and Expand all / Collapse all that also
 * reach sections not rendered yet.
 */

import * as React from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

const ALL = "__all";
type Memory = Record<string, boolean>;

function read(key: string): Memory {
  try {
    const raw = window.localStorage.getItem(`axf.fold:${key}`);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Memory) : {};
  } catch {
    return {};
  }
}

export interface SettingsFolds {
  isOpen: (id: string, defaultOpen?: boolean) => boolean;
  setOpen: (id: string, open: boolean) => void;
  setAll: (open: boolean) => void;
}

/** One dialog's fold memory on this device. */
export function useSettingsFolds(key: string): SettingsFolds {
  const [mem, setMem] = React.useState<Memory>({});
  React.useEffect(() => setMem(read(key)), [key]);
  const save = (next: Memory) => {
    setMem(next);
    try {
      window.localStorage.setItem(`axf.fold:${key}`, JSON.stringify(next));
    } catch {
      /* storage full or off: folds just aren't kept */
    }
  };
  return {
    isOpen: (id, defaultOpen = true) => mem[id] ?? mem[ALL] ?? defaultOpen,
    setOpen: (id, open) => save({ ...mem, [id]: open }),
    setAll: (open) => save({ [ALL]: open })
  };
}

export function SettingsFoldTools({ folds }: { folds: SettingsFolds }) {
  return (
    <Box role="toolbar" aria-label="Settings sections" sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
      <Button size="small" color="inherit" onClick={() => folds.setAll(true)}>Expand all</Button>
      <Button size="small" color="inherit" onClick={() => folds.setAll(false)}>Collapse all</Button>
    </Box>
  );
}

export function SettingsFold({ folds, id, title, children, defaultOpen }: {
  folds: SettingsFolds;
  id: string;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Accordion disableGutters elevation={0} expanded={folds.isOpen(id, defaultOpen)} onChange={(_, open) => folds.setOpen(id, open)}>
      <AccordionSummary expandIcon={<span aria-hidden>⌄</span>}>
        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{title}</Typography>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}
