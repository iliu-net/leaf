/**
 * render-fm.ts — shared frontmatter & system-info HTML rendering
 *
 * Pure functions: no DOM, no side-effects.  Used by both the View panel
 * and the Trash preview banner.
 */

import type { NoteData } from './notes.js';
import type { FrontmatterResult } from './frontmatter.js';
import { RESERVED_KEYS } from './frontmatter.js';
import { mergeTags } from './autotag.js';
import { formatTimestamp, relativeTime, esc, computeStats, html } from './utils.js';

// ── Utilities ──────────────────────────────────────────────────────────────

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

  // Tags row — merge user-tags and auto-tags
  const userTags: string[] = Array.isArray(meta['user-tags']) ? meta['user-tags'] : [];
  const autoTags: string[] = Array.isArray(meta['auto-tags']) ? meta['auto-tags'] : [];
  const mergedTags = mergeTags(userTags, autoTags);
  if (mergedTags.length > 0) {
    tableParts.push(html`<tr><td class="fm-key">Tags</td><td class="fm-val">${esc(mergedTags.join(', '))}</td></tr>`);
  }

  // Summary
  const summary = typeof meta['summary'] === 'string' ? meta['summary'] : '';
  if (summary) {
    tableParts.push(html`<tr><td class="fm-key">Summary</td><td class="fm-val">${esc(summary)}</td></tr>`);
  }

  // Custom fields — exclude anything in the shared reserved-keys set
  for (const [key, val] of Object.entries(meta)) {
    if (RESERVED_KEYS.has(key)) continue;
    tableParts.push(
      html`<tr><td class="fm-key">${esc(key)}</td><td class="fm-val">${esc(fmtVal(val))}</td></tr>`,
    );
  }

  if (tableParts.length === 0) return '';
  return html`<table class="fm-table">${tableParts.join('')}</table>`;
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
  return html`<h1 class="view-title">${esc(title)}</h1>${renderFrontmatterTable(fm)}`;
}

// ── Content stats ──────────────────────────────────────────────────────────

/**
 * Format a number of seconds into a human-readable duration string.
 * @param sec  Total seconds
 * @returns    e.g. "42 sec", "3 min", "1 hr 23 min"
 */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} sec`;
  const mins = Math.floor(sec / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) {
    const rem = mins % 60;
    return rem > 0 ? `${hours} hr ${rem} min` : `${hours} hr`;
  }
  return `${mins} min`;
}

/**
 * Render content statistics (word / char / line counts) as HTML.
 *
 * @param body  Body text (frontmatter already stripped).
 */
export function renderStats(body: string): string {
  if (!body) return '';

  const stats = computeStats(body);
  return `${stats.words.toLocaleString()} words · ${stats.chars.toLocaleString()} chars · ${stats.lines} lines`;
}

// ── System info ────────────────────────────────────────────────────────────

/**
 * Render system metadata (version, timestamps, authors) as an HTML table row set.
 *
 * @param noteData  Note record from IndexedDB.
 */
export function renderSystemInfo(noteData: NoteData): string {
  const rows: string[] = [];

  // Edit time (from frontmatter)
  const editTimeRaw = noteData.meta['edit-time'];
  const editTimeSec = typeof editTimeRaw === 'string' ? parseInt(editTimeRaw, 10) : 0;
  if (editTimeSec > 0) {
    rows.push(html`<tr><td>Edit time</td><td>${formatDuration(editTimeSec)}</td></tr>`);
  }

  if (noteData.current) {
    rows.push(html`<tr><td>Version</td><td>${esc(noteData.current)}</td></tr>`);
  }
  if (noteData.created_at || noteData.created_by) {
    rows.push(html`<tr><td>Created</td><td>`)
    if (noteData.created_at) {
      rows.push(html`${formatTimestamp(noteData.created_at)}`)
    }
    if (noteData.created_by) {
      rows.push(html` by ${esc(noteData.created_by)}`)
    }
    if (noteData.created_at) {
      rows.push(html` (${relativeTime(noteData.created_at)})`)
    }
    rows.push(html`</td></tr>`)
  }
  if (noteData.updated_at || noteData.updated_by) {
    rows.push(html`<tr><td>Updated</td><td>`)
    if (noteData.updated_at) {
      rows.push(html`${formatTimestamp(noteData.updated_at)}`)
    }
    if (noteData.updated_by) {
      rows.push(html` by ${esc(noteData.updated_by)}`)
    }
    if (noteData.updated_at) {
      rows.push(html` (${relativeTime(noteData.updated_at)})`)
    }
    rows.push(html`</td></tr>`)
  }
  if (rows.length === 0) return '';

  return html`<table class="meta-system-table">${rows.join('')}</table>`;
}
