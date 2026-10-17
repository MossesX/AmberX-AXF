import type { DialogMap } from './axf/react';
import { SuggestionsDialog } from './views/Catalog';
import { InstallWizardDialog, LibraryPickerDialog, OpenProjectDialog, UiImportWizardDialog } from './views/Wizards';
import { NewAppDialog } from './views/Boilerplates';

export const dialogs: DialogMap = {
  suggest: { title: 'Suggested features', icon: 'sparkles', render: (p, close) => <SuggestionsDialog itemId={String(p.item ?? '')} close={close} /> },
  libpicker: { title: 'Build a library', icon: 'box', render: (p, close) => <LibraryPickerDialog libraryId={String(p.library ?? '')} close={close} /> },
  install: { title: 'Install library', icon: 'download', render: (p, close) => <InstallWizardDialog libraryId={String(p.library ?? '')} close={close} /> },
  uiimport: { title: 'Import UI library', icon: 'download', render: (p, close) => <UiImportWizardDialog sourceId={String(p.source ?? '')} close={close} /> },
  project: { title: 'Open project', icon: 'folder', render: (_p, close) => <OpenProjectDialog close={close} /> },
  newapp: { title: 'Create app from boilerplate', icon: 'rocket', render: (p, close) => <NewAppDialog boilerplateId={String(p.boilerplate ?? '')} close={close} /> },
};
