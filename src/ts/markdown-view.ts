/**
 * markdown-view.ts — shared markdown rendering utilities
 *
 * Lazy-loads markdown-it on first render so it stays out of the initial
 * bundle.
 *
 * Exports:
 *   - renderView()           — content + metadata → HTML string
 *   - postProcessWikilinks() — title resolution & missing-link styling
 */

import type { NoteData } from './notes.js';
import { parseFrontmatter } from './frontmatter.js';
import {
  renderFrontmatter,
  renderStats,
  renderSystemInfo,
} from './render-fm.js';
import { html } from './utils.js';
import { dbGetNote } from './db.js';
import { expandTemplate } from './template.js';
import { isSystemNote, getSystemNote } from './system-notes/registry.js';

// ── Lazy markdown-it ────────────────────────────────────────────────────────

let _parseMarkdown: ((body: string) => string) | null = null;

async function _ensureMd(): Promise<(body: string) => string> {
  if (!_parseMarkdown) {
    const md = await import('./markdown.js');
    _parseMarkdown = md.parse;
  }
  return _parseMarkdown;
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
  let body = fm.body;

  // Template expansion (before markdown parsing so expanded
  // text renders as markdown).  Only active when template: true.
  if (fm.meta['template'] === 'true') {
    body = await expandTemplate(body, fm.meta, noteData.id);
  }

  const parts: string[] = [];

  // Title + frontmatter table
  parts.push(renderFrontmatter(fm, noteData));

  // Rendered markdown body
  parts.push(html`<div class="markdown-body">${parseMk(body)}</div>`);

  // Stats and system info
  const statsText = renderStats(body);
  const sysInfoHtml = renderSystemInfo(noteData);

  if (statsText || sysInfoHtml) {
    parts.push('<hr class="view-rule">');
    if (statsText) parts.push(html`<div class="view-stats">${statsText}</div>`);
    if (sysInfoHtml) parts.push(html`<div class="view-sysinfo">${sysInfoHtml}</div>`);
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
export async function postProcessWikilinks(root: Element): Promise<void> {
  const allLinks = root.querySelectorAll<HTMLAnchorElement>('a[data-note]');
  if (allLinks.length === 0) return;

  // Gather unique note IDs from ALL wikilinks (both title-resolution and
  // existence-check need the same data).
  const ids = new Set<string>();
  for (const link of allLinks) {
    const id = link.dataset.note;
    if (id) ids.add(id);
  }

  // Load all referenced notes.  null = note doesn't exist.
  const noteMap = new Map<string, string | null>();

  // Resolve system notes synchronously — they live in the registry, not IndexedDB
  for (const id of ids) {
    if (isSystemNote(id)) {
      noteMap.set(id, getSystemNote(id)?.content() ?? null);
    }
  }

  // Resolve user notes from IndexedDB (skip already-resolved system notes)
  const remaining = Array.from(ids).filter(id => !noteMap.has(id));
  await Promise.all(
    remaining.map(async (id) => {
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
