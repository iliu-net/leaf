/**
 * db.ts — Dexie database setup
 *
 * Two tables:
 *
 *   notes — the primary data store, one record per note
 *   {
 *     id:         string   — note identifier
 *     content:    string   — full raw text including frontmatter (opaque)
 *     created_at: number   — unix timestamp seconds, set once on CREATE
 *     updated_at: number   — unix timestamp seconds, updated on every save
 *     deleted:    0 | 1    — soft delete flag
 *   }
 *
 *   queue — pending changes waiting to be pushed to the server
 *   {
 *     seq:     number   — auto-increment, determines push order
 *     type:    string   — 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME'
 *     id:      string   — note id this change applies to
 *     content: string   — note content at time of change (null for DELETE)
 *     status:  string   — 'pending' | 'sent'
 *     renamed_to?: string — target id for RENAME
 *   }
 */

import Dexie, { type Table } from 'dexie';
import { getNamespace } from './local-store.js';
import { getSpaConfig } from './config.js';
import { getUsername } from './auth.js';
import { nowSec } from './utils.js';

// ── Constants ───────────────────────────────────────────────────────────


// ── Table row types ──────────────────────────────────────────────────────

export interface NoteRecord {
  id: string;
  content: string;
  created_at: number;
  updated_at: number;
  deleted: 0 | 1;
  current: string;     // version key — server-assigned or "local" for unsynced
  updated_by: string;  // author of last write (from server or local user)
  created_by: string;  // author who created the note
}

export interface QueueRecord {
  seq?: number;
  type: string;
  id: string;
  content: string | null;
  status: 'pending' | 'sent';
  renamed_to?: string;
  version: string;   // version the local edit was based on
}

// ── Database class ───────────────────────────────────────────────────────

class NotesDatabase extends Dexie {
  notes!: Table<NoteRecord, string>;
  queue!: Table<QueueRecord, number>;

  constructor() {
    const ns = getNamespace();
    super(ns ? `notes-app-${ns}` : 'notes-app');
    this.version(1).stores({
      notes: 'id, updated_at, deleted',
      queue: '++seq, status',
    });
  }
}

export const db = new NotesDatabase();

// ── Connection health ─────────────────────────────────────────────────────

/**
 * Ensure the IndexedDB connection is healthy.
 *
 * Firefox can close the underlying connection under storage pressure,
 * leaving the Dexie instance in a stale state.  This wrapper re-opens
 * the database if needed.
 */
export async function ensureDbOpen(): Promise<void> {
  if (!db.isOpen()) {
    await db.open();
  }
}

// ── Notes helpers ────────────────────────────────────────────────────────

/**
 * Return all live notes sorted by id, metadata only (no content).
 */
export async function dbListNotes(): Promise<Pick<NoteRecord, 'id' | 'created_at' | 'updated_at' | 'current'>[]> {
  await ensureDbOpen();
  const notes = await db.notes.where('deleted').equals(0).toArray();
  notes.sort((a, b) => a.id.localeCompare(b.id));
  return notes.map(({ id, created_at, updated_at, current }) => ({ id, created_at, updated_at, current }));
}

/**
 * Return one live note record, or null if missing/deleted.
 */
export async function dbGetNote(id: string): Promise<NoteRecord | null> {
  await ensureDbOpen();
  const note = await db.notes.get(id);
  if (!note || note.deleted) return null;
  return note;
}

/**
 * Write or update a note record in IndexedDB.
 * Preserves created_at if the note already exists.
 */
export async function dbSaveNote(id: string, content: string): Promise<void> {
  await ensureDbOpen();
  const now      = nowSec();
  const existing = await db.notes.get(id);
  await db.notes.put({
    id,
    content,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted:    0 as const,
    current:    existing?.current ?? 'local',
    updated_by: getUsername() ?? 'unknown',
    created_by: existing?.created_by ?? getUsername() ?? 'unknown',
  });
}

/**
 * Soft-delete a note (sets deleted=1).
 */
export async function dbDeleteNote(id: string): Promise<void> {
  await ensureDbOpen();
  const existing = await db.notes.get(id);
  if (!existing) return;
  await db.notes.put({ ...existing, deleted: 1 as const, updated_at: nowSec() });
}

/**
 * Create a new empty note if it doesn't already exist.
 */
export async function dbCreateNote(id: string): Promise<void> {
  await ensureDbOpen();
  const existing = await db.notes.get(id);
  if (existing) return;
  const now = nowSec();
  const uname = getUsername() ?? 'unknown';
  await db.notes.put({
    id, content: '', created_at: now, updated_at: now, deleted: 0 as const,
    current: 'local',
    created_by: uname,
    updated_by: uname,
  });
}

/**
 * Rename a note locally in IndexedDB.
 * Rewrites any pending queue entries for the old id to the new id.
 */
export async function dbRenameNote(oldId: string, newId: string): Promise<void> {
  await ensureDbOpen();
  const existing = await db.notes.get(oldId);
  if (!existing) return;
  await db.notes.put({ ...existing, id: newId, updated_at: nowSec() });
  await db.notes.delete(oldId);
  // Rewrite pending queue entries for old id → new id
  await dbRewriteQueueEntries(oldId, newId);
}

/**
 * Rewrite all pending queue entries that reference oldId to point to newId.
 * Used both by local renames (dbRenameNote) and server-pushed renames
 * (applyServerNoteChange in sync.ts).
 */
export async function dbRewriteQueueEntries(oldId: string, newId: string): Promise<void> {
  await ensureDbOpen();
  const pending = await db.queue
    .where('status').equals('pending')
    .filter(e => e.id === oldId)
    .toArray();
  for (const entry of pending) {
    await db.queue.update(entry.seq!, { id: newId });
  }
}

// ── Queue helpers ────────────────────────────────────────────────────────

/**
 * Add a change to the outbound queue.
 * For UPDATE/CREATE, collapses any existing pending entry for the same note
 * so we never push stale intermediate versions.
 * For RENAME, also collapses pending entries for the old id (they're superseded).
 *
 * Uses a single readwrite transaction so concurrent saves don't create
 * duplicate queue entries (which would cause unbounded queue growth).
 */
export async function queueChange(
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME',
  id: string,
  content: string | null = null,
  version: string = 'local',
  extra: Record<string, unknown> = {},
): Promise<void> {
  await ensureDbOpen();
  await db.transaction('rw', db.queue, async () => {
    if (type === 'UPDATE' || type === 'CREATE' || type === 'RENAME') {
      // Remove any pending (unsent) entry for this note to avoid redundant pushes
      await db.queue
        .where('status').equals('pending')
        .filter(e => e.id === id)
        .delete();
    }
    await db.queue.add({ type, id, content, status: 'pending', version, ...extra });
  });
}

/**
 * Return all pending queue entries in insertion order.
 */
export async function queueGetPending(): Promise<QueueRecord[]> {
  await ensureDbOpen();
  return db.queue.where('status').equals('pending').sortBy('seq');
}

/**
 * Mark a queue entry as sent (will be cleaned up later).
 */
export async function queueMarkSent(seq: number): Promise<void> {
  await ensureDbOpen();
  await db.queue.update(seq, { status: 'sent' });
}

/**
 * Remove all sent entries — called after a successful push+pull cycle.
 */
export async function queuePruneSent(): Promise<void> {
  await ensureDbOpen();
  await db.queue.where('status').equals('sent').delete();
}

// ── Trash helpers ─────────────────────────────────────────────────────────

/**
 * Return all local tombstones (deleted: 1).
 * Does NOT include purged (already removed) records.
 */
export async function dbListDeletedNotes(): Promise<{
  id: string; deleted_at: number; updated_by: string
}[]> {
  await ensureDbOpen();
  const notes = await db.notes.where('deleted').equals(1).toArray();
  return notes.map(n => ({
    id: n.id,
    deleted_at: n.updated_at,
    updated_by: n.updated_by,
  }));
}

/**
 * Restore a soft-deleted note: flip deleted to 0.
 * Idempotent — no-op if the note doesn't exist or isn't deleted.
 * Updates updated_by to the current user (consistent with dbSaveNote).
 */
export async function dbRestoreNote(id: string): Promise<void> {
  await ensureDbOpen();
  const existing = await db.notes.get(id);
  if (!existing || !existing.deleted) return;
  await db.notes.put({
    ...existing,
    deleted: 0 as const,
    updated_at: nowSec(),
    updated_by: getUsername() ?? 'unknown',
  });
}

/**
 * Full-text search across all active notes' content.
 * Returns metadata + a snippet of the matching content.
 */
export async function dbFullTextSearch(query: string): Promise<{
  id: string; created_at: number; updated_at: number; current: string; snippet: string;
}[]> {
  await ensureDbOpen();
  const q = query.toLowerCase();
  const notes = await db.notes.where('deleted').equals(0).toArray();
  const results: { id: string; created_at: number; updated_at: number; current: string; snippet: string }[] = [];
  for (const n of notes) {
    const idx = n.content.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    // Extract a snippet: ~40 chars around the match, capped at 80 chars total
    const start = Math.max(0, idx - 30);
    const end = Math.min(n.content.length, idx + q.length + 30);
    let snippet = n.content.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < n.content.length) snippet = snippet + '…';
    // Collapse whitespace for compact display
    snippet = snippet.replace(/\s+/g, ' ');
    results.push({
      id: n.id,
      created_at: n.created_at,
      updated_at: n.updated_at,
      current: n.current,
      snippet,
    });
  }
  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

/**
 * Hard-delete a note row from IndexedDB entirely.
 * Idempotent — no-op if the note doesn't exist.
 * Always calls ensureDbOpen() — Firefox may close the connection
 * under storage pressure.
 */
export async function dbPermanentDelete(id: string): Promise<void> {
  await ensureDbOpen();
  await db.notes.delete(id);
}

/**
 * Read a note regardless of its deleted flag.
 * Unlike dbGetNote (which filters out deleted records), this returns
 * tombstones too so getTrashContent can preview them.
 * Returns null only if the record doesn't exist at all.
 *
 * Includes `current` (the version key) so restoreTrashItem can pass
 * it to queueChange for conflict resolution when the note was
 * previously synced from the server.
 */
export async function dbGetNoteAny(id: string): Promise<{
  id: string; content: string; deleted: 0 | 1; current: string;
  created_at: number; updated_at: number;
  created_by: string; updated_by: string;
} | null> {
  await ensureDbOpen();
  const note = await db.notes.get(id);
  if (!note) return null;
  return {
    id: note.id,
    content: note.content,
    deleted: note.deleted,
    current: note.current,
    created_at: note.created_at,
    updated_at: note.updated_at,
    created_by: note.created_by,
    updated_by: note.updated_by,
  };
}

// ── Purge helpers ────────────────────────────────────────────────────────

/**
 * Permanently remove IndexedDB records that have been soft-deleted
 * (deleted: 1) and whose updated_at is older than deleted_notes_ttl_days.
 *
 * Called during app boot (showApp) so stale tombstones don't accumulate.
 */
export async function dbPurgeDeletedNotes(): Promise<void> {
  await ensureDbOpen();
  const ttlDays = getSpaConfig().deleted_notes_ttl_days;
  const cutoff = nowSec() - ttlDays * 86400;
  await db.notes
    .where('deleted').equals(1 as 0 | 1)
    .and(note => note.updated_at < cutoff)
    .delete();
}
