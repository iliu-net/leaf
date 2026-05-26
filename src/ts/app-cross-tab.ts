/**
 * app-cross-tab.ts — cross-tab change handler
 *
 * Extracted from app.ts.  Handles BroadcastChannel change notifications
 * from other tabs.  Receives core dependencies and callbacks for
 * file-list and trash-list refresh via factory function.
 */

import type { NoteData } from './notes.js';
import type { CrossTabMessage } from './cross-tab.js';

export interface CrossTabDeps {
  store: typeof import('./store.js');
  ui: typeof import('./ui.js');
  notes: typeof import('./notes.js');
  /** Callback to refresh the main file list (from app-files.ts). */
  refreshList: (selectId?: string | null) => Promise<void>;
  /** Callback to refresh the trash list (from app-trash.ts). */
  refreshTrashList: () => Promise<void>;
  /** Load trash entries and update the count badge. */
  loadTrashEntries: () => Promise<import('./trash-service.js').TrashEntry[]>;
}

export function createCrossTabHandler(deps: CrossTabDeps) {
  const { store, ui, notes, refreshList, refreshTrashList, loadTrashEntries } = deps;

  /**
   * Reload the currently-open note from IndexedDB and update the editor.
   * Called when another tab saved or server synced the note we have open.
   */
  async function reloadOpenNote(id: string): Promise<void> {
    try {
      const data: NoteData = await notes.loadNote(id);
      if (data.content === store.getContent()) return; // nothing changed
      store.openNote(id, data.content);
      ui.showEditor(data);
    } catch {
      // Note may have been deleted in the other tab
      store.closeNote();
      ui.hideEditor();
    }
  }

  /**
   * Reload a note under a new id (after a rename in another tab).
   */
  async function reloadOpenNoteAs(newId: string): Promise<void> {
    try {
      const data: NoteData = await notes.loadNote(newId);
      store.openNote(newId, data.content);
      ui.showEditor(data);
      ui.setActiveFile(newId);
    } catch {
      store.closeNote();
      ui.hideEditor();
    }
  }

  /**
   * Handle a change notification from another tab via BroadcastChannel.
   * Re-reads IndexedDB and updates the UI accordingly.
   */
  async function handleCrossTabChange(msg: CrossTabMessage): Promise<void> {
    const currentId = store.getCurrent();
    const inTrashMode = ui.getSidebarMode() === 'trash';

    switch (msg.type) {
      case 'saved':
      case 'created': {
        await refreshList(currentId);
        if (currentId && currentId === msg.id && !store.isDirty()) {
          await reloadOpenNote(currentId);
        }
        break;
      }

      case 'deleted': {
        if (inTrashMode) {
          await refreshTrashList();
        } else {
          await refreshList();
          loadTrashEntries().then(e => ui.setTrashCount(e.length));
          if (currentId && currentId === msg.id) {
            store.closeNote();
            ui.hideEditor();
            ui.toast(`"${msg.id}" was deleted in another tab`);
          }
        }
        break;
      }

      case 'renamed': {
        const newId = msg.newId;
        await refreshList(newId);
        if (currentId && currentId === msg.id && newId && !store.isDirty()) {
          await reloadOpenNoteAs(newId);
          ui.toast(`Renamed to "${newId}" in another tab`);
        }
        break;
      }

      case 'restored': {
        if (inTrashMode) {
          await refreshTrashList();
        } else {
          await refreshList(currentId);
          loadTrashEntries().then(e => ui.setTrashCount(e.length));
          if (currentId && currentId === msg.id && !store.isDirty()) {
            await reloadOpenNote(currentId);
          }
        }
        break;
      }

      case 'trash-emptied': {
        if (inTrashMode) {
          await refreshTrashList();
          ui.toast('Trash was emptied in another tab');
        } else {
          ui.setTrashCount(0);
        }
        break;
      }

      case 'server-sync': {
        if (inTrashMode) {
          await refreshTrashList();
        } else {
          await refreshList(currentId);
          loadTrashEntries().then(e => ui.setTrashCount(e.length));
          if (currentId && !store.isDirty()) {
            await reloadOpenNote(currentId);
          }
        }
        break;
      }
    }
  }

  return { handleCrossTabChange };
}
