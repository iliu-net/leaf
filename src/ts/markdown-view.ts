/**
 * markdown-view.ts — rendered markdown viewer tab
 *
 * Lazy-loads markdown-it on first render so it stays out of the initial
 * bundle.  Implements TabPanel for editor-ctrl.ts.
 *
 * Exports `renderView()` as the single shared read-only render path,
 * used by both the View tab and the Trash preview banner.
 */

import type { NoteData } from './notes.js';
import type { TabPanel, TabPanelContext } from './tab-panel.js';
import { parseFrontmatter } from './frontmatter.js';
import {
  renderFrontmatter,
  renderFrontmatterTable,
  renderStats,
  renderSystemInfo,
} from './render-fm.js';
import { esc } from './utils.js';
import { hydrate } from './fence-hydrate.js';

// ── Lazy markdown-it ────────────────────────────────────────────────────────

let _parseMarkdown: ((body: string) => string) | null = null;

async function _ensureMd(): Promise<(body: string) => string> {
  if (!_parseMarkdown) {
    const md = await import('./markdown.js');
    _parseMarkdown = md.parse;
  }
  return _parseMarkdown;
}

// ── DOM refs ────────────────────────────────────────────────────────────────

let _viewHeader:  HTMLElement | null = null;
let _viewContent: HTMLElement | null = null;

// ── Init (TabPanel) ─────────────────────────────────────────────────────────

/** One-time setup: cache DOM refs. */
export function init(): void {
  _viewHeader  = document.querySelector('#tab-view .view-header');
  _viewContent = document.querySelector('#tab-view .view-content');
}

// ── Shared rendering ────────────────────────────────────────────────────────

/**
 * Build the full rendered view HTML string from raw content and metadata.
 *
 * Used by both the View tab panel and the Trash preview banner — the
 * single read-only render path.
 *
 * @param content  Raw note content (frontmatter + body).
 * @param noteData Note metadata from IndexedDB.
 * @returns        Complete HTML string.
 */
export async function renderView(content: string, noteData: NoteData): Promise<string> {
  const parseMk = await _ensureMd();
  const fm = parseFrontmatter(content);
  const body = fm.body;

  const parts: string[] = [];

  // Title + frontmatter table
  parts.push(renderFrontmatter(fm, noteData));

  // Rendered markdown body
  parts.push(`<div class="markdown-body">${parseMk(body)}</div>`);

  // Stats and system info
  const statsText = renderStats(body);
  const sysInfoHtml = renderSystemInfo(noteData);

  if (statsText || sysInfoHtml) {
    parts.push('<hr class="view-rule">');
    if (statsText) parts.push(`<div class="view-stats">${statsText}</div>`);
    if (sysInfoHtml) parts.push(`<div class="view-sysinfo">${sysInfoHtml}</div>`);
  }

  return parts.join('');
}

// ── TabPanel lifecycle ──────────────────────────────────────────────────────

/**
 * Render the View tab panel.
 * The <h1> title sits in the fixed header; everything else scrolls.
 * Delegates to `renderView()` for the HTML — no duplication.
 */
export async function show(ctx: TabPanelContext): Promise<void> {
  if (!_viewHeader || !_viewContent) return;

  const html = await renderView(ctx.content, ctx.noteData);

  // Extract <h1> for fixed header, rest goes to scrollable body
  const m = html.match(/^(<h1[^>]*>.*?<\/h1>)/);
  _viewHeader.innerHTML = m ? m[1] : '';
  _viewContent.innerHTML = m ? html.slice(m[1].length) : html;

  // Hydrate fenced code blocks (syntax highlighting, diagrams)
  hydrate(_viewContent).catch(err =>
    console.warn('[markdown-view] hydrate failed:', err)
  );
}

/** Clear the View tab panel. */
export function hide(): void {
  if (_viewHeader)  _viewHeader.innerHTML = '';
  if (_viewContent) _viewContent.innerHTML = '';
}

/** TabPanel contract — typed lens for editor-ctrl.ts registration. */
export const tabPanel: TabPanel = { init, show, hide };
