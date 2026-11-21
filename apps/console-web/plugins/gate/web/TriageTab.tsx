/**
 * Model triage tab: the place kept for the VPS model triage gate (the gate that decides which model a build step runs
 * on). The gate is not built yet, so this tab has nothing to read or send; it says what will live here.
 */
import { Note } from '@console/axf/react';

export function TriageTab() {
  return (
    <div className="axp-gate__panel">
      <Note>Model triage is not live yet. This tab is ready for it.</Note>
      <p>When the VPS model triage gate ships, this tab shows:</p>
      <ul className="axp-gate__list">
        <li>which model each kind of step is sent to, and why;</li>
        <li>the triage rules, each with its on/off switch and settings;</li>
        <li>the last triage decisions, with the build and step they were for.</li>
      </ul>
      <p className="axp-gate__sub">The VPS will make every triage decision. This tab will only show them and send your changes to it.</p>
    </div>
  );
}
