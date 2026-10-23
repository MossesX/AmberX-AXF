import type { ComponentType } from 'react';
import { IndexPane, InspectorPane, ProjectsPane } from './outline';
import { GridPane } from './grid';
import { ReviewPane, ScriptPane } from './writing';
import { BrowserPane, EventsPane, FilesPane, RecordingsPane } from './capture';
import { CaptionsPane, ExportPane, PreviewPane, TimelinePane } from './video';
import { DashboardPane, LogPane, SettingsPane, TrashPane } from './project';

/** pane id (ui.ts PANES) → component */
export const PANE_VIEWS: Record<string, ComponentType> = {
  projects: ProjectsPane, index: IndexPane, grid: GridPane, inspector: InspectorPane,
  script: ScriptPane, review: ReviewPane,
  browser: BrowserPane, recordings: RecordingsPane, events: EventsPane, files: FilesPane,
  preview: PreviewPane, timeline: TimelinePane, captions: CaptionsPane, export: ExportPane,
  dashboard: DashboardPane, settings: SettingsPane, trash: TrashPane, log: LogPane,
};
