/**
 * history-service.ts — version history data fetching
 *
 * Extracted from history.ts. Handles the API layer for fetching
 * version metadata and content from the server.
 */

import { apiUrl } from './config.js';
import { getToken } from './auth.js';

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── API layer ───────────────────────────────────────────────────────────────

async function authFetch(url: string, body: unknown): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function fetchVersionList(id: string): Promise<VersionListResponse> {
  const res = await authFetch(apiUrl('history'), { action: 'list', id });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as VersionListResponse;
}

export async function fetchVersionContent(
  id: string,
  versions: string[],
): Promise<Record<string, string | null>> {
  const res = await authFetch(apiUrl('history'), { action: 'get', id, versions });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.contents ?? {};
}
