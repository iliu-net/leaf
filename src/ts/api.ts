/**
 * api.ts — centralised server API layer
 *
 * Thin typed wrappers around every server endpoint.  No business logic,
 * no state, no side effects beyond the HTTP call.  All authenticated
 * requests flow through authFetch() from auth.ts, which attaches the JWT
 * and retries once on 401 with a silent token refresh.
 *
 * One import to audit all server I/O.  One place to change error
 * handling, retry policy, or URL construction.
 */

import { authFetch } from './auth.js';
import { apiUrl } from './config.js';
import { clientID } from './local-store.js';

// ── URL helpers ──────────────────────────────────────────────────────────────

const SYNC_URL    = apiUrl('sync');
const TRASH_URL   = apiUrl('trash');
const HISTORY_URL = apiUrl('history');

// ── Sync types ───────────────────────────────────────────────────────────────

export interface SyncRequestBody {
  syncedRevision: number | null;
  changes: {
    type: number;
    key: string;
    obj: Record<string, unknown> | null;
  }[];
}

export interface SyncResponseBody {
  error?: string;
  changes?: SyncResponseChange[];
  currentRevision: number;
}

/** A single change entry in a sync response.  Shape varies by type. */
export interface SyncResponseChange {
  type: number;
  key: string;
  obj: SyncResponseObj | null;
}

/** Union of all possible obj shapes returned by the server. */
export interface SyncResponseObj {
  // CREATE / UPDATE (type 1, 2)
  content?: string | null;
  version?: string | null;          // absent for DELETE, present for CREATE/UPDATE/RENAME
  prev_version?: string | null;
  author?: string | null;
  created_by?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  // DELETE (type 3)
  deleted_by?: string | null;
  deleted_at?: number | null;
  // RENAME (type 4)
  renamed_to?: string;
  renamed_by?: string | null;
  renamed_at?: number | null;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncRequest(body: SyncRequestBody): Promise<SyncResponseBody> {
  const res = await authFetch(SYNC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...body, client_id: clientID.get() }),
  });

  // 401 after retry means auth has failed — authFetch already fired
  // onAuthFailure(), so we just throw to stop the tick
  if (res.status === 401) throw new Error('AUTH_FAILURE');

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json() as SyncResponseBody;
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Trash types ──────────────────────────────────────────────────────────────

export interface ServerTrashEntry {
  id: string;
  deleted_at: number | null;
  deleted_by: string;
}

export interface TrashRestoreResponse {
  ok: boolean;
  note: {
    id: string;
    created_at: number;
    content: string;
    current: string;
    created_by?: string;
  };
}

export interface TrashPreviewResponse {
  ok: boolean;
  note: {
    id: string;
    content: string;
    created_at: number;
    created_by: string;
    deleted_at: number;
    deleted_by: string;
  };
}

// ── Trash ────────────────────────────────────────────────────────────────────

export async function fetchTrashList(): Promise<ServerTrashEntry[]> {
  const res = await authFetch(TRASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { ok: boolean; data?: ServerTrashEntry[]; error?: string };
  if (data.error) throw new Error(data.error);
  return data.data ?? [];
}

export async function fetchTrashRestore(id: string): Promise<TrashRestoreResponse> {
  const res = await authFetch(TRASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restore', id, client_id: clientID.get() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as TrashRestoreResponse & { error?: string };
  if (data.error) throw new Error(data.error);
  return data;
}

export async function fetchTrashPreview(id: string): Promise<TrashPreviewResponse> {
  const res = await authFetch(TRASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'preview', id }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as TrashPreviewResponse & { error?: string };
  if (data.error) throw new Error(data.error);
  return data;
}

export async function fetchTrashPurge(id: string): Promise<void> {
  const res = await authFetch(TRASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'purge', id }),
  });
  if (res.status === 404) return; // already purged
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fetchTrashEmpty(): Promise<void> {
  const res = await authFetch(TRASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'empty' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── History types ────────────────────────────────────────────────────────────

export interface VersionMeta {
  key: string;
  author: string;
  saved_at: number;
  prev: string | null;
}

export interface VersionListResponse {
  ok: true;
  current: string | null;
  versions: VersionMeta[];
}

// ── History ──────────────────────────────────────────────────────────────────

export async function fetchVersionList(id: string): Promise<VersionListResponse> {
  const res = await authFetch(HISTORY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list', id }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as VersionListResponse;
}

export async function fetchVersionContent(
  id: string,
  versions: string[],
): Promise<Record<string, string | null>> {
  const res = await authFetch(HISTORY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get', id, versions }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.contents ?? {};
}
