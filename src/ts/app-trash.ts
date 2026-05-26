/**
 * app-trash.ts — trash list and item operations
 *
 * Extracted from app.ts.  Receives core dependencies and the file-list
 * refresh callback via factory function so the module is testable and
 * avoids circular imports with app.ts and app-files.ts.
 */

import { TrashView } from './trash-view.js';
import {
  loadTrashEntries, getTrashContent,
  restoreTrashItem, purgeTrashItem, emptyTrash,
} from './trash-service.js';

export interface TrashOpsDeps {
  store: typeof import('./store.js');
  ui: typeof import('./ui.js');
  sidebar: typeof import('./sidebar-chrome.js');
  /** Callback to refresh the main file list (from app-files.ts). */
  refreshList: (selectId?: string | null) => Promise<void>;
}

export function createTrashOps(deps: TrashOpsDeps) {
  const { store, ui, sidebar, refreshList } = deps;

  async function refreshTrashList(): Promise<void> {
    const entries = await loadTrashEntries();
    TrashView.render(entries, null);
    sidebar.setCurrentView(TrashView);
    ui.setTrashCount(entries.length);
  }

  async function handleToggleTrash(): Promise<void> {
    if (ui.getSidebarMode() === 'trash') {
      ui.setSidebarMode('notes');
      ui.hideTrashBanner();
      await refreshList();
    } else {
      ui.setSidebarMode('trash');
      await refreshTrashList();
    }
  }

  async function handleTrashPreview(id: string, source: 'local' | 'server'): Promise<void> {
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

  async function handleTrashRestore(id: string, source: 'local' | 'server'): Promise<void> {
    try {
      await restoreTrashItem(id, source);
      ui.hideTrashBanner();
      ui.setSidebarMode('notes');
      await refreshList(id);
      ui.toast(`Restored "${id}"`);
    } catch (err) {
      ui.toast(`Restore failed: ${(err as Error).message}`, true);
    }
  }

  async function handleTrashPurge(id: string, source: 'local' | 'server' | 'both'): Promise<void> {
    if (!confirm(`Permanently delete "${id}"? This cannot be undone.`)) return;
    await purgeTrashItem(id, source);
    ui.hideTrashBanner();
    await refreshTrashList();
    ui.toast(`Permanently deleted "${id}"`);
  }

  async function handleTrashEmpty(): Promise<void> {
    if (!confirm('Permanently delete ALL items in trash?')) return;
    await emptyTrash();
    ui.hideTrashBanner();
    await refreshTrashList();
    ui.toast('Trash emptied');
  }

  return {
    refreshTrashList,
    handleToggleTrash,
    handleTrashPreview,
    handleTrashRestore,
    handleTrashPurge,
    handleTrashEmpty,
  };
}
