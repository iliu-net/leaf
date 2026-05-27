/**
 * app-cross-tab.ts — cross-tab change handler
 *
 * Handles BroadcastChannel change notifications from other tabs.
 * Imports refreshList and refreshTrashList directly — no callbacks.
 */

import * as store from './store.js';
import * as ui    from './ui.js';
import * as notes from './notes.js';
import type { NoteData } from './notes.js';
import type { CrossTabMessage } from './cross-tab.js';
import { refreshList } from './app-files.js';
import { refreshTrashList } from './app-trash.js';
import { loadTrashEntries } from './trash-service.js';

// ── Reload helpers ────────────────────────────────────────────────────────

async function reloadOpenNote(id: string): Promise<void> {
  try {
    const data: NoteData = await notes.loadNote(id);
    if (data.content === store.getContent()) return;
    store.openNote(id, data.content);
    ui.showEditor(data);
  } catch {
    store.closeNote();
    ui.hideEditor();
  }
}

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

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleCrossTabChange(msg: CrossTabMessage): Promise<void> {
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
