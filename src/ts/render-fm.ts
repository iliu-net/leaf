/**
 * render-fm.ts — shared frontmatter & system-info HTML rendering
 *
 * Pure functions: no DOM, no side-effects.  Used by both the View panel
 * and the Trash preview banner.
 */

import type { NoteData } from './notes.js';
import type { FrontmatterResult } from './frontmatter.js';
import { formatTimestamp } from './utils.js';

// ── Utilities ──────────────────────────────────────────────────────────────

/** Minimal HTML-escaping for display values. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert a frontmatter value to a display string. */
export function fmtVal(v: string | string[] | undefined): string {
  if (v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ');
  return v;
}

// ── Frontmatter rendering ──────────────────────────────────────────────────

/**
 * Build the frontmatter <table> rows (tags, summary, custom fields)
 * WITHOUT a title.  Callers can place the <h1> separately.
 */
export function renderFrontmatterTable(fm: FrontmatterResult): string {
  const meta = fm.meta;
  const tableParts: string[] = [];

  // Tags row
  const userTags = Array.isArray(meta['user-tags']) ? meta['user-tags'] : [];
  if (userTags.length > 0) {
    const sorted = [...userTags].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
    tableParts.push(`<tr><td class="fm-key">Tags</td><td class="fm-val">${esc(sorted.join(', '))}</td></tr>`);
  }

  // Summary
  const summary = typeof meta['summary'] === 'string' ? meta['summary'] : '';
  if (summary) {
    tableParts.push(`<tr><td class="fm-key">Summary</td><td class="fm-val">${esc(summary)}</td></tr>`);
  }

  // Custom fields
  const reservedKeys = new Set(['title', 'summary', 'user-tags', 'auto-tags']);
  for (const [key, val] of Object.entries(meta)) {
    if (reservedKeys.has(key)) continue;
    tableParts.push(
      `<tr><td class="fm-key">${esc(key)}</td><td class="fm-val">${esc(fmtVal(val))}</td></tr>`,
    );
  }

  if (tableParts.length === 0) return '';
  return `<table class="fm-table">${tableParts.join('')}</table>`;
}

/**
 * Render the parsed frontmatter as an HTML table with a title heading.
 *
 * @param fm       Freshly parsed frontmatter result.
 * @param noteData Note metadata (used for title fallback to note id).
 */
export function renderFrontmatter(
  fm: FrontmatterResult,
  noteData: NoteData,
): string {
  const meta = fm.meta;
  const title = (typeof meta['title'] === 'string' ? meta['title'] : '') || noteData.id;
  return `<h1 class="view-title">${esc(title)}</h1>` + renderFrontmatterTable(fm);
}

// ── Content stats ──────────────────────────────────────────────────────────

/**
 * Render content statistics (word / char / line counts) as HTML.
 *
 * @param body  Body text (frontmatter already stripped).
 */
export function renderStats(body: string): string {
  if (!body) return '';

  const chars = body.length;
  const words = body.trim() === '' ? 0 : body.trim().split(/\s+/).length;
  const lines = body === '' ? 0 : body.split('\n').length;

  return `${words.toLocaleString()} words · ${chars.toLocaleString()} chars · ${lines} lines`;
}

// ── System info ────────────────────────────────────────────────────────────

/**
 * Render system metadata (version, timestamps, authors) as an HTML table row set.
 *
 * @param noteData  Note record from IndexedDB.
 */
export function renderSystemInfo(noteData: NoteData): string {
  const rows: string[] = [];

  if (noteData.current) {
    rows.push(`<tr><td>Version</td><td>${esc(noteData.current)}</td></tr>`);
  }
  if (noteData.created_at) {
    rows.push(`<tr><td>Created</td><td>${formatTimestamp(noteData.created_at)}</td></tr>`);
  }
  if (noteData.updated_at) {
    rows.push(`<tr><td>Updated</td><td>${formatTimestamp(noteData.updated_at)}</td></tr>`);
  }
  if (noteData.created_by) {
    rows.push(`<tr><td>Created by</td><td>${esc(noteData.created_by)}</td></tr>`);
  }
  if (noteData.updated_by) {
    rows.push(`<tr><td>Updated by</td><td>${esc(noteData.updated_by)}</td></tr>`);
  }

  if (rows.length === 0) return '';

  return `<table class="meta-system-table">${rows.join('')}</table>`;
}
