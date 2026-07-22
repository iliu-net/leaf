/**
 * change-handler.ts — cross-tab change event handler
 *
 * Pure handler that reacts to change-bus events.  All side effects
 * (state mutation, UI updates, data access) go through the deps
 * object so the handler is independently testable.
 */

import type { ChangeEvent } from './change-bus.js';

// ── Dependencies (injected by app.ts) ──────────────────────────────────────

export interface ChangeHandlerDeps {
  /** App-level current note ID, snapshot at call time. */
  currentId: string | null;
  /** Whether the sidebar is in trash mode, snapshot at call time. */
  isTrashMode: boolean;

  /** Reload the currently open note in-place (for cross-tab updates). */
  reloadCurrentNote(): Promise<void>;
  /** Reload the editor for a renamed note (new ID). */
  reloadNoteAs(newId: string): Promise<void>;

  /** The note ID currently displayed in the editor (may differ from currentId). */
  editorNoteId(): string | null;

  /** Refresh the sidebar note list. */
  refreshSidebar(): Promise<void>;
  /** Refresh the trash list. */
  refreshTrash(): Promise<void>;

  /** Clear editor state and hide the editor UI. */
  clearEditor(): void;
  /** Update the trash count badge from IndexedDB. */
  updateTrashCount(): void;

  /** Show a toast notification. */
  toast(msg: string): void;
  /** Set the trash count directly (used on trash-emptied). */
  setTrashCount(n: number): void;

  /** Highlight a note in the sidebar. */
  setActiveNote(id: string): void;
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleChange(
  deps: ChangeHandlerDeps,
  msg: ChangeEvent,
): Promise<void> {
  const currentId = deps.currentId;
  const inTrashMode = deps.isTrashMode;

  switch (msg.type) {
    case 'saved':
    case 'created': {
      // Refresh sidebar list only — don't re-open (content is already
      // current from the save that just happened).
      await deps.refreshSidebar();
      // Fix highlight: the editor may be showing a different note than
      // app-level currentId (e.g. createNote opens a note before
      // currentId is updated, and the synchronous publish races refreshList).
      const editorId = deps.editorNoteId();
      if (editorId && editorId !== currentId) {
        deps.setActiveNote(editorId);
      }
      break;
    }

    case 'deleted': {
      if (inTrashMode) {
        await deps.refreshTrash();
      } else {
        await deps.refreshSidebar();
        deps.updateTrashCount();
        if (currentId && currentId === msg.id) {
          deps.clearEditor();
          deps.toast(`"${msg.id}" was deleted in another tab`);
        }
      }
      break;
    }

    case 'renamed': {
      const newId = msg.newId;
      await deps.refreshSidebar();  // sidebar only — reloadNoteAs handles the editor
      if (currentId && currentId === msg.id && newId) {
        await deps.reloadNoteAs(newId);
        deps.toast(`Renamed to "${newId}" in another tab`);
      }
      break;
    }

    case 'restored': {
      if (inTrashMode) {
        await deps.refreshTrash();
      } else {
        await deps.refreshSidebar();  // sidebar only — reloadCurrentNote handles the editor
        deps.updateTrashCount();
        if (currentId && currentId === msg.id) {
          await deps.reloadCurrentNote();
        }
      }
      break;
    }

    case 'trash-emptied': {
      if (inTrashMode) {
        await deps.refreshTrash();
        deps.toast('Trash was emptied in another tab');
      } else {
        deps.setTrashCount(0);
      }
      break;
    }

    case 'server-sync': {
      if (inTrashMode) {
        await deps.refreshTrash();
      } else {
        await deps.refreshSidebar();  // sidebar only — reloadCurrentNote handles the editor
        deps.updateTrashCount();
        if (currentId) {
          await deps.reloadCurrentNote();
        }
      }
      break;
    }
  }
}
