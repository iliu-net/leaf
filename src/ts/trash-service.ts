/**
 * trash-service.ts — Trash business logic & server API
 *
 * Owns all trash logic — merge, restore, purge, empty, and server
 * communication.  The UI layer (trash-view.ts, app.ts) calls these
 * functions directly.
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
import { getUsername } from './auth.js';
import { publish } from './change-bus.js';
import { getNamespace } from './config.js';
import { syncNow } from './sync.js';
import { nowSec } from './utils.js';
import {
  fetchTrashList, fetchTrashRestore, fetchTrashPreview,
  fetchTrashPurge, fetchTrashEmpty,
} from './api.js';
import type {
  ServerTrashEntry, TrashRestoreResponse, TrashPreviewResponse,
} from './api.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LocalTrashEntry {
  id: string;
  deleted_at: number;
  updated_by: string;
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

// ── Merge ───────────────────────────────────────────────────────────────────

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

// ── Pending purge tracking ──────────────────────────────────────────────────

const _NS = getNamespace();
const PENDING_PURGE_KEY = _NS
  ? `leaf-trash-pending-purge:${_NS}`
  : 'leaf-trash-pending-purge';

function getPendingPurges(): Set<string> {
  try {
    const raw = localStorage.getItem(PENDING_PURGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr as string[]);
  } catch {
    return new Set();
  }
}

function trackPendingPurge(id: string): void {
  const set = getPendingPurges();
  set.add(id);
  localStorage.setItem(PENDING_PURGE_KEY, JSON.stringify([...set]));
}

function dropPendingPurge(id: string): void {
  const set = getPendingPurges();
  set.delete(id);
  localStorage.setItem(PENDING_PURGE_KEY, JSON.stringify([...set]));
}

/**
 * Flush pending server-side purges that were deferred while offline.
 * Each call is fire-and-forget — individual failures are benign.
 */
export async function flushPendingPurges(): Promise<void> {
  const ids = [...getPendingPurges()];
  for (const id of ids) {
    fetchTrashPurge(id).then(() => dropPendingPurge(id)).catch(() => {
      // benign — retried on next online event
    });
  }
}

// ── Load ────────────────────────────────────────────────────────────────────

/**
 * Load and merge trash entries from both local IndexedDB and the server.
 * Returns newest-first sorted list.
 */
export async function loadTrashEntries(): Promise<TrashEntry[]> {
  const local = await dbListDeletedNotes();

  if (!navigator.onLine) {
    return local.map(l => ({
      id: l.id,
      deleted_at: l.deleted_at,
      source: 'local' as const,
      updated_by: l.updated_by,
    })).sort((a, b) => b.deleted_at - a.deleted_at);
  }

  try {
    const pendingPurges = getPendingPurges();
    const server = await fetchTrashList();
    const filtered = server.filter(s => !pendingPurges.has(s.id));
    return mergeTrashEntries(local, filtered);
  } catch {
    console.warn('[trash-service] Server fetch failed, using local tombstones only');
    return local.map(l => ({
      id: l.id,
      deleted_at: l.deleted_at,
      source: 'local' as const,
      updated_by: l.updated_by,
    })).sort((a, b) => b.deleted_at - a.deleted_at);
  }
}

// ── Preview ─────────────────────────────────────────────────────────────────

/**
 * Get the content of a deleted note for read-only preview.
 * Local / both: reads from IndexedDB via dbGetNoteAny.
 * Server-only: fetches from the trash preview endpoint.
 */
export async function getTrashContent(
  id: string,
  source: 'local' | 'server',
): Promise<TrashContent | null> {
  if (source === 'local') {
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

// ── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restore a note from the trash.
 * Source 'both' should be normalized to 'server' by the caller.
 */
export async function restoreTrashItem(
  id: string,
  source: 'local' | 'server',
): Promise<void> {
  if (source === 'local') {
    // Local-only tombstone: flip deleted flag and queue a CREATE
    await dbRestoreNote(id);
    const note = await dbGetNoteAny(id);
    await queueChange('CREATE', id, note?.content ?? '', note?.current ?? 'local');
    publish({ type: 'restored', id });
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

    publish({ type: 'restored', id });
    // No queueChange — server already has the note.
    // No syncNow — we just talked to the server.
  }
}

// ── Purge ───────────────────────────────────────────────────────────────────

/**
 * Permanently delete a single trash item.
 */
export async function purgeTrashItem(
  id: string,
  source: 'local' | 'server' | 'both',
): Promise<void> {
  if (source !== 'local') {
    if (navigator.onLine) {
      try { await fetchTrashPurge(id); } catch { /* ignore */ }
    } else {
      trackPendingPurge(id);
    }
  }

  await dbPermanentDelete(id);
  publish({ type: 'deleted', id });
}

// ── Empty ───────────────────────────────────────────────────────────────────

/**
 * Permanently delete ALL items in the trash.
 */
export async function emptyTrash(): Promise<void> {
  const tombstones = await dbListDeletedNotes();
  const ids = tombstones.map(n => n.id);

  if (navigator.onLine) {
    try { await fetchTrashEmpty(); } catch {
      for (const id of ids) trackPendingPurge(id);
    }
  } else {
    for (const id of ids) trackPendingPurge(id);
  }

  await ensureDbOpen();
  await db.notes.bulkDelete(ids);
  publish({ type: 'trash-emptied', id: '' });
}
