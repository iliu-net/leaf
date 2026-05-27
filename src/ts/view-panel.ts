/**
 * view-panel.ts — View tab panel (rendered markdown)
 *
 * Lazy-loaded via dynamic import() from editor.ts on first switch to the
 * View tab.  Also reused by the Trash preview banner.
 *
 * Exports `renderView()` so both consumers share a single read-only
 * render path.  No duplication.
 */

import { parseFrontmatter } from './frontmatter.js';
import { renderFrontmatter, renderFrontmatterTable, renderStats, renderSystemInfo, esc } from './render-fm.js';
import { parse as parseMarkdown } from './markdown.js';
import type { NoteData } from './notes.js';

// ── DOM refs ────────────────────────────────────────────────────────────────

let _viewHeader:  HTMLElement | null = null;
let _viewContent: HTMLElement | null = null;

// ── Init ────────────────────────────────────────────────────────────────────

/** One-time setup: cache DOM refs. */
export function initViewPanel(): void {
  _viewHeader  = document.querySelector('#tab-view .view-header');
  _viewContent = document.querySelector('#tab-view .view-content');
}

// ── Shared rendering ────────────────────────────────────────────────────────

/**
 * Build the full rendered view HTML string from raw content and metadata.
 *
 * Used by both the View tab panel and the Trash preview banner so there
 * is only one read-only render path.
 *
 * @param content  Raw note content (frontmatter + body).
 * @param noteData Note metadata from IndexedDB.
 * @returns        Complete HTML string.
 */
export function renderView(content: string, noteData: NoteData): string {
  const fm = parseFrontmatter(content);
  const body = fm.body;

  const parts: string[] = [];

  // Title + frontmatter table
  parts.push(renderFrontmatter(fm, noteData));

  // Rendered markdown body
  parts.push(`<div class="markdown-body">${parseMarkdown(body)}</div>`);

  // Stats and system info — in the content flow (scrolls away, not fixed)
  const statsText = renderStats(body);
  const sysInfoHtml = renderSystemInfo(noteData);

  if (statsText || sysInfoHtml) {
    parts.push('<hr class="view-rule">');
    if (statsText) {
      parts.push(`<div class="view-stats">${statsText}</div>`);
    }
    if (sysInfoHtml) {
      parts.push(`<div class="view-sysinfo">${sysInfoHtml}</div>`);
    }
  }

  return parts.join('');
}

// ── Panel lifecycle ─────────────────────────────────────────────────────────

/**
 * Render the View tab panel from raw note content and metadata.
 * Only the <h1> title sits in the fixed header; everything else scrolls.
 */
export function showViewPanel(content: string, noteData: NoteData): void {
  if (!_viewHeader || !_viewContent) return;

  const fm = parseFrontmatter(content);
  const body = fm.body;
  const meta = fm.meta;

  // ── Fixed header: title only ─────────────────────────────────────
  const title = (typeof meta['title'] === 'string' ? meta['title'] : '') || noteData.id;
  _viewHeader.innerHTML = `<h1 class="view-title">${esc(title)}</h1>`;

  // ── Scrollable body: table + markdown + stats + sysinfo ───────────
  const parts: string[] = [];

  // Frontmatter table (no title — renderFrontmatterTable handles that)
  const tableHtml = renderFrontmatterTable(fm);
  if (tableHtml) parts.push(tableHtml);

  // Markdown body
  parts.push(`<div class="markdown-body">${parseMarkdown(body)}</div>`);

  // Stats and system info
  const statsText = renderStats(body);
  const sysInfoHtml = renderSystemInfo(noteData);

  if (statsText || sysInfoHtml) {
    parts.push('<hr class="view-rule">');
    if (statsText) {
      parts.push(`<div class="view-stats">${statsText}</div>`);
    }
    if (sysInfoHtml) {
      parts.push(`<div class="view-sysinfo">${sysInfoHtml}</div>`);
    }
  }

  _viewContent.innerHTML = parts.join('');
}

/**
 * Clear the View tab panel.
 */
export function hideViewPanel(): void {
  if (_viewHeader)  _viewHeader.innerHTML = '';
  if (_viewContent) _viewContent.innerHTML = '';
}
