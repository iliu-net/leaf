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
import { dbGetNote } from './db.js';

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

  // Wikilink navigation — intercept clicks on [[page]] links and dispatch
  // a custom event so app.ts can open the note without a page reload.
  _viewContent?.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-note]');
    if (!link) return;

    e.preventDefault();
    const id = link.dataset.note;
    if (!id) return;

    _viewContent!.dispatchEvent(new CustomEvent('navigate-note', {
      bubbles: true,
      detail: { id },
    }));
  });
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

// ── Post-render wikilink processing ──────────────────────────────────────────

/**
 * Batch-process all wikilinks after markdown rendering:
 *
 *   1. [[page|]] → replace link text with the target note's frontmatter title
 *   2. Add "wikilink-missing" class to links whose target note doesn't exist
 *
 * Both operations share a single batch IndexedDB lookup over all wikilinks
 * in the rendered content.
 */
async function _postProcessWikilinks(root: Element): Promise<void> {
  const allLinks = root.querySelectorAll<HTMLAnchorElement>('a[data-note]');
  if (allLinks.length === 0) return;

  // Gather unique note IDs from ALL wikilinks (both title-resolution and
  // existence-check need the same data).
  const ids = new Set<string>();
  for (const link of allLinks) {
    const id = link.dataset.note;
    if (id) ids.add(id);
  }

  // Load all referenced notes in parallel.  null = note doesn't exist.
  const noteMap = new Map<string, string | null>();
  await Promise.all(
    Array.from(ids).map(async (id) => {
      try {
        const note = await dbGetNote(id);
        noteMap.set(id, note?.content ?? null);
      } catch {
        noteMap.set(id, null);
      }
    }),
  );

  // Parse titles — only for notes that exist and have frontmatter
  const titleMap = new Map<string, string>();
  for (const [id, content] of noteMap) {
    if (content) {
      const fm = parseFrontmatter(content);
      const title = typeof fm.meta['title'] === 'string' ? fm.meta['title'].trim() : '';
      if (title) titleMap.set(id, title);
    }
  }

  // Walk links and apply both transforms
  for (const link of allLinks) {
    const id = link.dataset.note!;

    // 1. Missing link styling
    if (!noteMap.get(id)) {
      link.classList.add('wikilink-missing');
    }

    // 2. Title resolution ([[page|]])
    if (link.hasAttribute('data-resolve-title')) {
      const title = titleMap.get(id);
      if (title) link.textContent = title;
      link.removeAttribute('data-resolve-title');
    }
  }
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

  // Post-process wikilinks: resolve [[page|]] titles, mark missing links
  _postProcessWikilinks(_viewContent).catch(err =>
    console.warn('[markdown-view] wikilink post-process failed:', err)
  );

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
