/**
 * trash-ctrl.ts — trash list and item operations
 *
 * Handles toggling trash mode, previewing, restoring, purging, and emptying
 * trash items. Imports refreshList from notes-ctrl.ts directly — no callbacks.
 */

import * as ui      from './ui.js';
import * as sidebar from './sidebar.js';
import {
  loadTrashEntries, getTrashContent,
  restoreTrashItem, purgeTrashItem, emptyTrash,
} from './trash.js';
import { refreshList } from './notes-ctrl.js';

// ── Trash list ────────────────────────────────────────────────────────────

export async function refreshTrashList(): Promise<void> {
  const entries = await loadTrashEntries();
  // Render via the SidebarView interface — the active view was set by setMode()
  sidebar.getView()!.render(entries, null);
  sidebar.setTrashCount(entries.length);
}

export async function handleToggleTrash(): Promise<void> {
  if (sidebar.getMode() === 'trash') {
    sidebar.setMode('notes');
    ui.hideTrashBanner();
    await refreshList();
  } else {
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
  ui.showTrashBanner(id, result.content, {
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
    ui.hideTrashBanner();
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
  ui.hideTrashBanner();
  await refreshTrashList();
  ui.toast(`Permanently deleted "${id}"`);
}

export async function handleTrashEmpty(): Promise<void> {
  if (!confirm('Permanently delete ALL items in trash?')) return;
  await emptyTrash();
  ui.hideTrashBanner();
  await refreshTrashList();
  ui.toast('Trash emptied');
}
