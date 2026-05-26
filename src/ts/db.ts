/**
 * db.ts — Dexie database setup
 *
 * Two tables:
 *
 *   notes — the primary data store, one record per note
 *   {
 *     id:         string   — note identifier
 *     content:    string   — full raw text including frontmatter (opaque)
 *     created_at: number   — unix timestamp ms, set once on CREATE
 *     updated_at: number   — unix timestamp ms, updated on every save
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
import { getNamespace } from './config.js';

// ── Constants ───────────────────────────────────────────────────────────

/** Permanently remove IndexedDB records that have been soft-deleted
 *  for longer than this many days.  Keeps the client cache lean without
 *  losing the offline restore window. */
const PURGE_DELETED_DAYS = 7;

// ── Table row types ──────────────────────────────────────────────────────

export interface NoteRecord {
  id: string;
  content: string;
  created_at: number;
  updated_at: number;
  deleted: 0 | 1;
  current: string;   // version key — server-assigned or "local" for unsynced
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
  const now      = Date.now();
  const existing = await db.notes.get(id);
  await db.notes.put({
    id,
    content,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted:    0 as const,
    current:    existing?.current ?? 'local',
  });
}

/**
 * Soft-delete a note (sets deleted=1).
 */
export async function dbDeleteNote(id: string): Promise<void> {
  await ensureDbOpen();
  const existing = await db.notes.get(id);
  if (!existing) return;
  await db.notes.put({ ...existing, deleted: 1 as const, updated_at: Date.now() });
}

/**
 * Create a new empty note if it doesn't already exist.
 */
export async function dbCreateNote(id: string): Promise<void> {
  await ensureDbOpen();
  const existing = await db.notes.get(id);
  if (existing) return;
  const now = Date.now();
  await db.notes.put({ id, content: '', created_at: now, updated_at: now, deleted: 0 as const, current: 'local' });
}

/**
 * Rename a note locally in IndexedDB.
 * Rewrites any pending queue entries for the old id to the new id.
 */
export async function dbRenameNote(oldId: string, newId: string): Promise<void> {
  await ensureDbOpen();
  const existing = await db.notes.get(oldId);
  if (!existing) return;
  await db.notes.put({ ...existing, id: newId, updated_at: Date.now() });
  await db.notes.delete(oldId);
  // Rewrite pending queue entries for old id → new id
  const pending = await db.queue
    .where('status').equals('pending')
    .filter(e => e.id === oldId)
    .toArray();
  for (const entry of pending) {
    await db.queue.update(entry.seq!, { id: newId });
  }
}

/**
 * Apply a change received from the server into the local notes table.
 * Does not touch the queue — server changes are not re-queued.
 */
export async function dbApplyServerChange(
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME',
  id: string,
  content: string | null,  // holds the new id for RENAME
  version?: string | null,
  _prevVersion?: string | null,  // unused now, needed for future conflict resolution
): Promise<void> {
  await ensureDbOpen();
  if (type === 'DELETE') {
    const existing = await db.notes.get(id);
    if (existing) {
      await db.notes.put({ ...existing, deleted: 1 as const, updated_at: Date.now() });
    }
    return;
  }
  if (type === 'RENAME') {
    const newId = content;
    if (!newId) return;
    const existing = await db.notes.get(id);
    if (!existing) return;
    await db.notes.put({ ...existing, id: newId, updated_at: Date.now() });
    await db.notes.delete(id);
    // Rewrite pending queue entries for old id → new id
    const pending = await db.queue
      .where('status').equals('pending')
      .filter(e => e.id === id)
      .toArray();
    for (const entry of pending) {
      await db.queue.update(entry.seq!, { id: newId });
    }
    return;
  }
  // CREATE or UPDATE
  const existing = await db.notes.get(id);
  await db.notes.put({
    id,
    content:    content ?? '',
    created_at: existing?.created_at ?? Date.now(),
    updated_at: Date.now(),
    deleted:    0 as const,
    current:    version ?? existing?.current ?? 'local',
  });
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

// ── Purge helpers ────────────────────────────────────────────────────────

/**
 * Permanently remove IndexedDB records that have been soft-deleted
 * (deleted: 1) and whose updated_at is older than PURGE_DELETED_DAYS.
 *
 * Called during app boot (showApp) so stale tombstones don't accumulate.
 */
export async function dbPurgeDeletedNotes(): Promise<void> {
  await ensureDbOpen();
  const cutoff = Date.now() - PURGE_DELETED_DAYS * 86400 * 1000;
  await db.notes
    .where('deleted').equals(1 as 0 | 1)
    .and(note => note.updated_at < cutoff)
    .delete();
}
