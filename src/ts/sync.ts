/**
 * sync.ts — lightweight offline sync queue
 *
 * All server requests go through authFetch() from auth.js, which
 * automatically attaches the JWT and retries once on 401.
 * If auth fails completely, syncStart() stops and onAuthFailure()
 * in auth.js fires so app.js can show the login screen.
 *
 * State machine:
 *   OFFLINE  ←→  IDLE  →  SYNCING  →  IDLE
 *                              ↓ (on error)
 *                            ERROR  →  IDLE (after retry delay)
 */

import {
  queueGetPending,
  queueMarkSent,
  queuePruneSent,
  dbApplyServerChange,
} from './db.js';
import type { QueueRecord } from './db.js';

import { authFetch } from './auth.js';

// ── Types ────────────────────────────────────────────────────────────────

type SyncStatus = 'OFFLINE' | 'IDLE' | 'SYNCING' | 'ERROR';
type StatusListener = (status: SyncStatus, isOnline: boolean) => void;
type ChangeListener = () => void;

interface SyncRequestBody {
  baseRevision: number | null;
  syncedRevision: number | null;
  changes: {
    type: number;
    key: string;
    obj: Record<string, unknown> | null;
  }[];
  partial: boolean;
}

interface SyncResponseBody {
  error?: string;
  changes?: {
    type: number;
    key: string;
    obj?: {
      content?: string | null;
      renamed_to?: string;
      version: string;
      prev_version?: string | null;
    } | null;
  }[];
  currentRevision: number;
}

// ── Config ────────────────────────────────────────────────────────────────

const SYNC_URL      = '../api/sync.php';
const POLL_INTERVAL = 30_000;   // ms between polls when online
const RETRY_DELAY   = 10_000;   // ms before retrying after an error
const REVISION_KEY  = 'notes_sync_revision';

// ── Status ────────────────────────────────────────────────────────────────

let currentStatus: SyncStatus = navigator.onLine ? 'IDLE' : 'OFFLINE';
const statusListeners: StatusListener[] = [];

function setStatus(s: SyncStatus): void {
  if (s === currentStatus) return;
  console.log('[sync] status: %s → %s', currentStatus, s);
  currentStatus = s;
  statusListeners.forEach(fn => fn(s, s === 'IDLE' || s === 'SYNCING'));
}

/**
 * Subscribe to sync status changes.
 * handler(statusText, isOnline) — isOnline is true for IDLE/SYNCING.
 * @returns unsubscribe function
 */
export function onSyncStatus(handler: StatusListener): () => void {
  statusListeners.push(handler);
  handler(currentStatus, currentStatus !== 'OFFLINE' && currentStatus !== 'ERROR');
  return () => {
    const i = statusListeners.indexOf(handler);
    if (i !== -1) statusListeners.splice(i, 1);
  };
}

export function getSyncStatus(): SyncStatus { return currentStatus; }

// ── Revision tracking ─────────────────────────────────────────────────────

function getRevision(): number | null {
  const v = localStorage.getItem(REVISION_KEY);
  return v === null ? null : Number(v);
}

function setRevision(rev: number | null | undefined): void {
  if (rev !== null && rev !== undefined) {
    localStorage.setItem(REVISION_KEY, String(rev));
  }
}

// ── Change listeners ──────────────────────────────────────────────────────

const changeListeners: ChangeListener[] = [];

export function onRemoteChange(fn: ChangeListener): () => void {
  changeListeners.push(fn);
  return () => {
    const i = changeListeners.indexOf(fn);
    if (i !== -1) changeListeners.splice(i, 1);
  };
}

function notifyRemoteChange(): void {
  changeListeners.forEach(fn => fn());
}

// ── Authenticated sync request ────────────────────────────────────────────

async function syncRequest(body: SyncRequestBody): Promise<SyncResponseBody> {
  const res = await authFetch(SYNC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  // 401 after retry means auth has failed — authFetch already fired
  // onAuthFailure(), so we just throw to stop the tick
  if (res.status === 401) throw new Error('AUTH_FAILURE');

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json() as SyncResponseBody;
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Push — send local queue to server ────────────────────────────────────

async function push(): Promise<{ sent: number; received: number }> {
  const pending = await queueGetPending();
  const sent = pending.length;
  if (sent === 0) return { sent: 0, received: 0 };

  // Log each outgoing note
  for (const entry of pending) {
    const ver = entry.version ?? '?';
    console.log('[sync] push  → %s  %s  (v%s)', entry.type, entry.id, ver);
  }

  const typeToInt: Record<string, number> = { CREATE: 1, UPDATE: 2, DELETE: 3, RENAME: 4 };
  const changes = pending.map((entry: QueueRecord) => ({
    type: typeToInt[entry.type] ?? 3,
    key:  entry.id,
    obj:  entry.type === 'DELETE' ? null
        : entry.type === 'RENAME'  ? { renamed_to: entry.renamed_to!, version: entry.version }
        : { id: entry.id, content: entry.content, version: entry.version },
  }));

  const syncedRevision = getRevision();
  const data = await syncRequest({
    baseRevision: syncedRevision, syncedRevision, changes, partial: false,
  });

  for (const entry of pending) await queueMarkSent(entry.seq!);
  const received = await applyServerChanges(data.changes ?? [], data.currentRevision);
  return { sent, received };
}

// ── Pull — fetch server changes since last revision ───────────────────────

async function pull(): Promise<number> {
  const syncedRevision = getRevision();
  const data = await syncRequest({
    baseRevision: syncedRevision, syncedRevision, changes: [], partial: false,
  });
  return await applyServerChanges(data.changes ?? [], data.currentRevision);
}

// ── Apply server changes to local IndexedDB ───────────────────────────────

async function applyServerChanges(
  changes: SyncResponseBody['changes'],
  currentRevision: number,
): Promise<number> {
  let count = 0;
  for (const change of changes ?? []) {
    const typeMap: Record<number, string> = { 1: 'CREATE', 2: 'UPDATE', 3: 'DELETE', 4: 'RENAME' };
    const type = typeMap[change.type] ?? null;
    if (!type) continue;
    const ver = change.obj?.version ?? '?';
    if (type === 'RENAME') {
      const newId = change.obj?.renamed_to;
      console.log('[sync] recv  ← RENAME  %s → %s  (v%s)', change.key, newId, ver);
      if (newId) await dbApplyServerChange('RENAME', change.key, newId);
    } else {
      console.log('[sync] recv  ← %s  %s  (v%s)', type, change.key, ver);
      await dbApplyServerChange(
        type as 'CREATE' | 'UPDATE' | 'DELETE',
        change.key,
        change.obj?.content ?? null,
        change.obj?.version,
        change.obj?.prev_version,
      );
    }
    count++;
  }
  setRevision(currentRevision);
  if (count > 0) notifyRemoteChange();
  return count;
}

// ── Tick — one full push + pull cycle ────────────────────────────────────

let running = false;
let stopped = false;

async function tick(): Promise<void> {
  if (running || stopped) return;
  if (!navigator.onLine) { setStatus('OFFLINE'); return; }

  running = true;
  setStatus('SYNCING');

  try {
    const pushResult = await push();
    const recvCount   = await pull() + pushResult.received;
    await queuePruneSent();

    const sentCount = pushResult.sent;
    if (sentCount > 0 || recvCount > 0) {
      console.log('[sync] done → sent %d, received %d', sentCount, recvCount);
    }

    setStatus('IDLE');
  } catch (err) {
    if (err instanceof Error && err.message === 'AUTH_FAILURE') {
      // Auth failure is handled by auth.js — stop polling silently
      setStatus('OFFLINE');
      running = false;
      return;
    }
    console.warn('[sync] Tick failed:', (err as Error).message);
    setStatus('ERROR');
    setTimeout(() => {
      if (currentStatus === 'ERROR') setStatus(navigator.onLine ? 'IDLE' : 'OFFLINE');
    }, RETRY_DELAY);
  } finally {
    running = false;
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePoll(): void {
  clearTimeout(pollTimer!);
  pollTimer = setTimeout(async () => {
    await tick();
    schedulePoll();
  }, POLL_INTERVAL);
}

export function stopSync(): void {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
  stopped = true;
}

/** Clear the stored revision — used before resetting the database. */
export function clearRevision(): void {
  localStorage.removeItem(REVISION_KEY);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Start the sync loop. Call once after successful login/session restore.
 */
export async function syncStart(): Promise<void> {
  stopped = false;
  window.addEventListener('online', async () => {
    setStatus('IDLE');
    await tick();
    schedulePoll();
  });

  window.addEventListener('offline', () => {
    setStatus('OFFLINE');
    if (pollTimer !== null) clearTimeout(pollTimer);
  });

  if (navigator.onLine) {
    await tick();
    schedulePoll();
  } else {
    setStatus('OFFLINE');
  }
}

/**
 * Trigger an immediate sync tick (e.g. right after a save).
 */
export async function syncNow(): Promise<void> {
  await tick();
  schedulePoll();
}
