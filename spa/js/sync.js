/**
 * sync.js — lightweight offline sync queue
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

import { authFetch } from './auth.js';

// ── Config ────────────────────────────────────────────────────────────────

const SYNC_URL      = '../api/sync.php';
const POLL_INTERVAL = 30_000;   // ms between polls when online
const RETRY_DELAY   = 10_000;   // ms before retrying after an error
const REVISION_KEY  = 'notes_sync_revision';

// ── Status ────────────────────────────────────────────────────────────────

/** @type {'OFFLINE'|'IDLE'|'SYNCING'|'ERROR'} */
let currentStatus = navigator.onLine ? 'IDLE' : 'OFFLINE';
const statusListeners = [];

function setStatus(s) {
  if (s === currentStatus) return;
  currentStatus = s;
  statusListeners.forEach(fn => fn(s, s === 'IDLE' || s === 'SYNCING'));
}

/**
 * Subscribe to sync status changes.
 * handler(statusText, isOnline) — isOnline is true for IDLE/SYNCING.
 * @param {function} handler
 * @returns {function} unsubscribe
 */
export function onSyncStatus(handler) {
  statusListeners.push(handler);
  handler(currentStatus, currentStatus !== 'OFFLINE' && currentStatus !== 'ERROR');
  return () => {
    const i = statusListeners.indexOf(handler);
    if (i !== -1) statusListeners.splice(i, 1);
  };
}

export function getSyncStatus() { return currentStatus; }

// ── Revision tracking ─────────────────────────────────────────────────────

function getRevision() {
  const v = localStorage.getItem(REVISION_KEY);
  return v === null ? null : Number(v);
}

function setRevision(rev) {
  if (rev !== null && rev !== undefined) {
    localStorage.setItem(REVISION_KEY, String(rev));
  }
}

// ── Change listeners ──────────────────────────────────────────────────────

const changeListeners = [];

export function onRemoteChange(fn) {
  changeListeners.push(fn);
  return () => {
    const i = changeListeners.indexOf(fn);
    if (i !== -1) changeListeners.splice(i, 1);
  };
}

function notifyRemoteChange() {
  changeListeners.forEach(fn => fn());
}

// ── Authenticated sync request ────────────────────────────────────────────

async function syncRequest(body) {
  const res = await authFetch(SYNC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  // 401 after retry means auth has failed — authFetch already fired
  // onAuthFailure(), so we just throw to stop the tick
  if (res.status === 401) throw new Error('AUTH_FAILURE');

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Push — send local queue to server ────────────────────────────────────

async function push() {
  const pending = await queueGetPending();
  if (pending.length === 0) return;

  const typeToInt = { CREATE: 1, UPDATE: 2, DELETE: 3, RENAME: 4 };
  const changes = pending.map(entry => ({
    type: typeToInt[entry.type] ?? 3,
    key:  entry.id,
    obj:  entry.type === 'DELETE' ? null
        : entry.type === 'RENAME'  ? { renamed_to: entry.renamed_to }
        : { id: entry.id, content: entry.content },
  }));

  const syncedRevision = getRevision();
  const data = await syncRequest({
    baseRevision: syncedRevision, syncedRevision, changes, partial: false,
  });

  for (const entry of pending) await queueMarkSent(entry.seq);
  await applyServerChanges(data.changes ?? [], data.currentRevision);
}

// ── Pull — fetch server changes since last revision ───────────────────────

async function pull() {
  const syncedRevision = getRevision();
  const data = await syncRequest({
    baseRevision: syncedRevision, syncedRevision, changes: [], partial: false,
  });
  await applyServerChanges(data.changes ?? [], data.currentRevision);
}

// ── Apply server changes to local IndexedDB ───────────────────────────────

async function applyServerChanges(changes, currentRevision) {
  let hadChanges = false;
  for (const change of changes) {
    const typeMap = { 1: 'CREATE', 2: 'UPDATE', 3: 'DELETE', 4: 'RENAME' };
    const type = typeMap[change.type] ?? null;
    if (!type) continue;
    if (type === 'RENAME') {
      const newId = change.obj?.renamed_to;
      if (newId) await dbApplyServerChange('RENAME', change.key, newId);
    } else {
      await dbApplyServerChange(type, change.key, change.obj?.content ?? null);
    }
    hadChanges = true;
  }
  setRevision(currentRevision);
  if (hadChanges) notifyRemoteChange();
}

// ── Tick — one full push + pull cycle ────────────────────────────────────

let running = false;

async function tick() {
  if (running) return;
  if (!navigator.onLine) { setStatus('OFFLINE'); return; }

  running = true;
  setStatus('SYNCING');

  try {
    await push();
    await pull();
    await queuePruneSent();
    setStatus('IDLE');
  } catch (err) {
    if (err.message === 'AUTH_FAILURE') {
      // Auth failure is handled by auth.js — stop polling silently
      setStatus('OFFLINE');
      running = false;
      return;
    }
    console.warn('[sync] Tick failed:', err.message);
    setStatus('ERROR');
    setTimeout(() => {
      if (currentStatus === 'ERROR') setStatus(navigator.onLine ? 'IDLE' : 'OFFLINE');
    }, RETRY_DELAY);
  } finally {
    running = false;
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────

let pollTimer = null;

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await tick();
    schedulePoll();
  }, POLL_INTERVAL);
}

export function stopSync() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Start the sync loop. Call once after successful login/session restore.
 */
export async function syncStart() {
  window.addEventListener('online', async () => {
    setStatus('IDLE');
    await tick();
    schedulePoll();
  });

  window.addEventListener('offline', () => {
    setStatus('OFFLINE');
    clearTimeout(pollTimer);
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
export async function syncNow() {
  await tick();
  schedulePoll();
}
