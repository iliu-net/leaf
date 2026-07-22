/**
 * useTrash.ts — Hook wrapping the trash data layer.
 *
 * Imports from trash.ts for local IndexedDB operations and from api.ts for
 * server-side trash operations.  Handles merging local + server tombstones
 * so server-only deleted items also appear in the trash view.
 *
 * Phase 3: used by Sidebar for trash mode toggle and item count.
 * Phase 5: extended with server-side restore/purge/preview/empty.
 */

import { useAppDispatch, useAppState } from '../state/AppContext.js';
import {
  mergeTrashEntries,
  loadLocalTrashEntries,
  getLocalTrashContent,
  restoreLocalTrash,
  purgeLocalTrash,
  emptyLocalTrash,
} from '../trash.js';
import type { TrashEntry, TrashContent } from '../trash.js';
import {
  fetchTrashList,
  fetchTrashRestore,
  fetchTrashPreview,
  fetchTrashPurge,
  fetchTrashEmpty,
} from '../api.js';
import { getUsername } from '../auth.js';
import { nowSec } from '../utils.js';
import { ensureDbOpen, db } from '../db.js';
import { publish } from '../change-bus.js';
import * as notes from '../notes.js';

/* ── Module-level state ─────────────────────────────────────────────────── */

/** Saved note ID when entering trash — restored on exit. */
let _lastNoteId: string | null = null;

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Convert raw local tombstones → TrashEntry[], newest first. */
export function localToTrashEntries(
  local: { id: string; deleted_at: number; updated_by: string }[],
): TrashEntry[] {
  return local
    .map(l => ({
      id: l.id,
      deleted_at: l.deleted_at,
      source: 'local' as const,
      updated_by: l.updated_by,
    }))
    .sort((a, b) => b.deleted_at - a.deleted_at);
}

/**
 * Load merged trash entries (local + server).
 * Standalone so it can be called from useChangeBus without the hook.
 */
export async function loadMergedTrashEntries(): Promise<TrashEntry[]> {
  const local = await loadLocalTrashEntries();

  if (!navigator.onLine) {
    return localToTrashEntries(local);
  }

  try {
    const server = await fetchTrashList();
    return mergeTrashEntries(local, server);
  } catch {
    console.warn('[trash] Server fetch failed, using local tombstones only');
    return localToTrashEntries(local);
  }
}

/* ── Hook ────────────────────────────────────────────────────────────────── */

export function useTrash() {
  const dispatch = useAppDispatch();
  const state = useAppState();

  return {
    /** Current trash entries from context. */
    trash: state.trash,

    /** Refresh trash list — merges local + server tombstones when online. */
    async refreshTrashList(): Promise<TrashEntry[]> {
      const entries = await loadMergedTrashEntries();
      dispatch({ type: 'TRASH_LOADED', trash: entries });
      return entries;
    },

    /** Get content for read-only preview (local or server). */
    async getContent(
      id: string,
      source: 'local' | 'server',
    ): Promise<TrashContent | null> {
      if (source === 'local') {
        return await getLocalTrashContent(id);
      }

      // Server-only: fetch preview from API
      try {
        const data = await fetchTrashPreview(id);
        return {
          id: data.note.id,
          content: data.note.content,
          created_at: data.note.created_at,
          created_by: data.note.created_by,
        };
      } catch {
        return null;
      }
    },

    /** Restore a note from the trash (handles both local and server). */
    async restoreItem(
      id: string,
      source: 'local' | 'server',
    ): Promise<void> {
      if (source === 'local') {
        await restoreLocalTrash(id);
      } else {
        // Server path: the server revives the note + appends a changelog entry.
        // Other clients pick up the restore on their next sync.
        const data = await fetchTrashRestore(id);
        const { note } = data;

        await ensureDbOpen();
        await db.notes.put({
          id,
          content: note.content,
          created_at: note.created_at,
          updated_at: nowSec(),
          deleted: 0 as const,
          current: note.current,
          updated_by: getUsername() ?? 'unknown',
          created_by: note.created_by ?? getUsername() ?? 'unknown',
        });

        publish({ type: 'restored', id });
      }
    },

    /** Permanently delete a single trash item (handles both local and server). */
    async purgeItem(
      id: string,
      source: 'local' | 'server' | 'both',
    ): Promise<void> {
      // Purge from server if applicable
      if (source !== 'local' && navigator.onLine) {
        try {
          await fetchTrashPurge(id);
        } catch {
          /* ignore — still purge locally */
        }
      }

      await purgeLocalTrash(id);
    },

    /** Permanently delete ALL items in the trash (local + server). */
    async emptyAll(): Promise<void> {
      if (navigator.onLine) {
        try {
          await fetchTrashEmpty();
        } catch {
          /* ignore — still empty locally */
        }
      }

      await emptyLocalTrash();
    },

    /** Toggle trash mode in the sidebar. */
    async toggleTrash(): Promise<void> {
      if (state.sidebarMode === 'trash') {
        dispatch({ type: 'CLEAR_TRASH_PREVIEW' });
        dispatch({ type: 'SET_SIDEBAR_MODE', mode: 'notes' });

        // Restore the note that was open before entering trash
        const restoreId = _lastNoteId;
        _lastNoteId = null;
        if (restoreId) {
          try {
            const data = await notes.loadNote(restoreId);
            dispatch({
              type: 'NOTE_SELECTED',
              id: restoreId,
              content: data.content,
              isSystemNote: notes.isSystemNote(restoreId),
              noteData: {
                created_at: data.created_at,
                updated_at: data.updated_at,
                current: data.current,
                created_by: data.created_by,
                updated_by: data.updated_by,
                meta: data.meta,
              },
            });
          } catch {
            dispatch({ type: 'CLEAR_EDITOR' });
          }
        }
      } else {
        // Save the current note before clearing the editor
        _lastNoteId = state.activeNoteId;
        dispatch({ type: 'CLEAR_EDITOR' });
        dispatch({ type: 'SET_SIDEBAR_MODE', mode: 'trash' });
        // Load merged entries (local + server) so server-only tombstones appear
        const entries = await loadMergedTrashEntries();
        dispatch({ type: 'TRASH_LOADED', trash: entries });
      }
    },
  };
}

// Re-export types used by consumers
export type { TrashEntry, TrashContent };
