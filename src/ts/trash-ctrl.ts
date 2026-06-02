/**
 * trash-ctrl.ts — trash list and item operations
 *
 * Handles toggling trash mode, previewing, restoring, purging, and emptying
 * trash items.  This is the cross-cutting orchestration layer — it wires
 * together local DB (trash.ts), server API, sync, and auth.
 */

import * as ui        from './ui.js';
import * as sidebar   from './sidebar.js';
import * as trashView from './trash-view.js';
import {
  mergeTrashEntries,
  loadLocalTrashEntries,
  getLocalTrashContent,
  restoreLocalTrash,
  purgeLocalTrash,
  emptyLocalTrash,
} from './trash.js';
import type { TrashEntry, TrashContent } from './trash.js';
import { refreshList } from './notes-ctrl.js';
import {
  fetchTrashList, fetchTrashRestore, fetchTrashPreview,
  fetchTrashPurge, fetchTrashEmpty,
} from './api.js';
import { getUsername } from './auth.js';
import { syncNow } from './sync.js';
import { nowSec } from './utils.js';
import { ensureDbOpen, db } from './db.js';

// ── Orchestration: load / merge ────────────────────────────────────────────

/**
 * Load and merge trash entries from both local IndexedDB and the server.
 * Returns newest-first sorted list.
 */
export async function loadTrashEntries(): Promise<TrashEntry[]> {
  const local = await loadLocalTrashEntries();

  if (!navigator.onLine) {
    return local.map(l => ({
      id: l.id,
      deleted_at: l.deleted_at,
      source: 'local' as const,
      updated_by: l.updated_by,
    })).sort((a, b) => b.deleted_at - a.deleted_at);
  }

  try {
    const server = await fetchTrashList();
    return mergeTrashEntries(local, server);
  } catch {
    console.warn('[trash] Server fetch failed, using local tombstones only');
    return local.map(l => ({
      id: l.id,
      deleted_at: l.deleted_at,
      source: 'local' as const,
      updated_by: l.updated_by,
    })).sort((a, b) => b.deleted_at - a.deleted_at);
  }
}

// ── Orchestration: preview ─────────────────────────────────────────────────

/**
 * Get the content of a deleted note for read-only preview.
 * Local / both: reads from IndexedDB (via model).
 * Server-only: fetches from the server trash preview endpoint.
 */
export async function getTrashContent(
  id: string,
  source: 'local' | 'server',
): Promise<TrashContent | null> {
  if (source === 'local') {
    return await getLocalTrashContent(id);
  }

  // server-only
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
}

// ── Orchestration: restore ─────────────────────────────────────────────────

/**
 * Restore a note from the trash.
 * Source 'both' should be normalized to 'server' by the caller.
 */
export async function restoreTrashItem(
  id: string,
  source: 'local' | 'server',
): Promise<void> {
  if (source === 'local') {
    // Local-only tombstone: flip deleted flag, queue CREATE, sync
    await restoreLocalTrash(id);
    await syncNow();
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

    // No queueChange — server already has the note.
    // No syncNow — we just talked to the server.
  }
}

// ── Orchestration: purge ───────────────────────────────────────────────────

/**
 * Permanently delete a single trash item.
 */
export async function purgeTrashItem(
  id: string,
  source: 'local' | 'server' | 'both',
): Promise<void> {
  if (source !== 'local' && navigator.onLine) {
    try { await fetchTrashPurge(id); } catch { /* ignore */ }
  }

  await purgeLocalTrash(id);
}

// ── Orchestration: empty ───────────────────────────────────────────────────

/**
 * Permanently delete ALL items in the trash.
 */
export async function emptyTrash(): Promise<void> {
  if (navigator.onLine) {
    try { await fetchTrashEmpty(); } catch { /* ignore */ }
  }

  await emptyLocalTrash();
}

// ── Trash list ────────────────────────────────────────────────────────────

export async function refreshTrashList(): Promise<void> {
  const entries = await loadTrashEntries();
  // Render via the SidebarView interface — the active view was set by setMode()
  sidebar.getView()!.render(entries, null);
  sidebar.setTrashCount(entries.length);
}

let _lastNoteId: string | null = null;

export async function handleToggleTrash(): Promise<void> {
  if (sidebar.getMode() === 'trash') {
    // Leaving trash → restore folder view and last-selected note
    sidebar.setMode('notes');
    trashView.hideTrashPreview();
    await refreshList(_lastNoteId);
    _lastNoteId = null;
  } else {
    // Entering trash → hide editor, remember current note for return
    _lastNoteId = ui.getCurrentNoteId();
    ui.hideEditor();
    sidebar.setMode('trash');
    await refreshTrashList();
  }
}

export async function handleTrashPreview(id: string, source: 'local' | 'server'): Promise<void> {
  const result = await getTrashContent(id, source);
  if (!result) {
    ui.toast('Content not available', true);
    return;
  }
  trashView.showTrashPreview(id, result.content, {
    created_at: result.created_at,
    updated_at: result.updated_at,
    created_by: result.created_by,
    updated_by: result.updated_by,
    current: result.current,
  },
    () => handleTrashRestore(id, source),
    () => handleTrashPurge(id, source),
  );
}

export async function handleTrashRestore(id: string, source: 'local' | 'server'): Promise<void> {
  try {
    await restoreTrashItem(id, source);
    trashView.hideTrashPreview();
    sidebar.setMode('notes');
    await refreshList(id);
    ui.toast(`Restored "${id}"`);
  } catch (err) {
    ui.toast(`Restore failed: ${(err as Error).message}`, true);
  }
}

export async function handleTrashPurge(id: string, source: 'local' | 'server' | 'both'): Promise<void> {
  if (!confirm(`Permanently delete "${id}"? This cannot be undone.`)) return;
  await purgeTrashItem(id, source);
  trashView.hideTrashPreview();
  await refreshTrashList();
  ui.toast(`Permanently deleted "${id}"`);
}

export async function handleTrashEmpty(): Promise<void> {
  if (!confirm('Permanently delete ALL items in trash?')) return;
  await emptyTrash();
  trashView.hideTrashPreview();
  await refreshTrashList();
  ui.toast('Trash emptied');
}
