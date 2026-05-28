/**
 * trash.ts — Trash data access layer
 *
 * All reads/writes go to IndexedDB.  The server is never called directly
 * from here.  Cross-cutting orchestration (server API, sync, auth) lives
 * in trash-ctrl.ts — same pattern as notes.ts.
 */

import {
  dbListDeletedNotes,
  dbRestoreNote,
  dbPermanentDelete,
  dbGetNoteAny,
  ensureDbOpen,
  db,
  queueChange,
} from './db.js';
import { publish } from './change-bus.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LocalTrashEntry {
  id: string;
  deleted_at: number;
  updated_by: string;
}

/** Slim server tombstone shape — only the fields mergeTrashEntries needs. */
export interface ServerTrashEntry {
  id: string;
  deleted_at: number | null;
}

export interface TrashEntry {
  id: string;
  deleted_at: number;
  source: 'local' | 'server' | 'both';
  updated_by?: string;
}

export interface TrashContent {
  id: string;
  content: string;
  created_at?: number;
  updated_at?: number;
  created_by?: string;
  updated_by?: string;
  current?: string;
}

// ── Merge (pure function) ───────────────────────────────────────────────────

export function mergeTrashEntries(
  local: LocalTrashEntry[],
  server: ServerTrashEntry[],
): TrashEntry[] {
  const map = new Map<string, TrashEntry>();

  for (const l of local) {
    map.set(l.id, {
      id: l.id,
      deleted_at: l.deleted_at,
      source: 'local',
      updated_by: l.updated_by,
    });
  }

  for (const s of server) {
    const existing = map.get(s.id);
    if (existing) {
      const serverTs = s.deleted_at ?? 0;
      existing.source = 'both';
      if (serverTs > existing.deleted_at) {
        existing.deleted_at = serverTs;
      }
    } else {
      map.set(s.id, {
        id: s.id,
        deleted_at: s.deleted_at ?? 0,
        source: 'server',
      });
    }
  }

  // Sort newest-first by deleted_at
  return [...map.values()].sort((a, b) => b.deleted_at - a.deleted_at);
}

// ── Local-only data access ──────────────────────────────────────────────────

/** Raw tombstones from IndexedDB — for merging with server data. */
export async function loadLocalTrashEntries(): Promise<LocalTrashEntry[]> {
  return await dbListDeletedNotes();
}

/**
 * Load locally-deleted notes as a formatted TrashEntry list.
 * No network — usable offline.
 */
export async function loadLocalTrash(): Promise<TrashEntry[]> {
  const local = await loadLocalTrashEntries();
  return local.map(l => ({
    id: l.id,
    deleted_at: l.deleted_at,
    source: 'local' as const,
    updated_by: l.updated_by,
  })).sort((a, b) => b.deleted_at - a.deleted_at);
}

/**
 * Get content of a locally-deleted note for read-only preview.
 * Returns null if the note doesn't exist or isn't deleted.
 */
export async function getLocalTrashContent(id: string): Promise<TrashContent | null> {
  const note = await dbGetNoteAny(id);
  if (!note || !note.deleted) return null;
  return {
    id: note.id,
    content: note.content,
    created_at: note.created_at,
    updated_at: note.updated_at,
    created_by: note.created_by,
    updated_by: note.updated_by,
    current: note.current,
  };
}

/**
 * Restore a locally-deleted note (flip tombstone flag + queue CREATE).
 * Caller (trash-ctrl.ts) should trigger syncNow afterwards.
 */
export async function restoreLocalTrash(id: string): Promise<void> {
  await dbRestoreNote(id);
  const note = await dbGetNoteAny(id);
  await queueChange('CREATE', id, note?.content ?? '', note?.current ?? 'local');
  publish({ type: 'restored', id });
}

/** Permanently delete a single item from the local trash. */
export async function purgeLocalTrash(id: string): Promise<void> {
  await dbPermanentDelete(id);
  publish({ type: 'deleted', id });
}

/** Permanently delete ALL items from the local trash. */
export async function emptyLocalTrash(): Promise<void> {
  const tombstones = await dbListDeletedNotes();
  const ids = tombstones.map(n => n.id);
  await ensureDbOpen();
  await db.notes.bulkDelete(ids);
  publish({ type: 'trash-emptied', id: '' });
}
