/**
 * ViewTab.tsx — Rendered markdown viewer tab.
 *
 * Phase 4a: delegates to markdown-view.ts's renderView(), splits <h1> title
 *           into the fixed header and everything else into the scrollable body.
 *           Wikilink clicks dispatched via onOpenNote callback to load a note.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../state/AppContext.js';
import { useNotes } from '../hooks/useNotes.js';
import { renderView, postProcessWikilinks } from '../markdown-view.js';
import { hydrate } from '../fence-hydrate.js';
import type { NoteData } from '../notes.js';

// ── Search highlight helpers ────────────────────────────────────────────────

/**
 * Remove all `<mark class="search-highlight">` wrappers, restoring original
 * text nodes.  Idempotent — safe to call even with no highlights present.
 */
function _clearHighlights(root: Element): void {
  const marks = root.querySelectorAll('mark.search-highlight');
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    }
  }
}

/**
 * Walk text nodes in `root` and wrap case-insensitive matches of `query`
 * in `<mark class="search-highlight">` elements.
 */
function _highlightMatches(root: Element, query: string): void {
  const q = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }
  for (const node of textNodes) {
    const text = node.textContent || '';
    const lower = text.toLowerCase();
    if (lower.indexOf(q) === -1) continue;

    const parent = node.parentNode!;
    const frag = document.createDocumentFragment();
    let pos = 0;
    while (pos < text.length) {
      const nextIdx = text.toLowerCase().indexOf(q, pos);
      if (nextIdx === -1) {
        frag.appendChild(document.createTextNode(text.slice(pos)));
        break;
      }
      if (nextIdx > pos) {
        frag.appendChild(document.createTextNode(text.slice(pos, nextIdx)));
      }
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = text.slice(nextIdx, nextIdx + q.length);
      frag.appendChild(mark);
      pos = nextIdx + q.length;
    }
    parent.replaceChild(frag, node);
  }
}

export default function ViewTab() {
  const { activeNoteId, activeNoteContent, activeNoteData, searchQuery } = useAppState();
  const { loadNote } = useNotes();

  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Counter incremented on every content write — used as a trigger for
  // downstream effects (search highlighting) that previously depended on
  // bodyHtml state.
  const [bodyVersion, setBodyVersion] = useState(0);

  // ── Render markdown → direct DOM write ────────────────────────────────
  //
  // Writes innerHTML directly on the ref elements instead of going through
  // React's dangerouslySetInnerHTML.  This means React does NOT own the
  // DOM subtree inside these elements and will never reset it during
  // reconciliation — eliminating the flash caused by React "repairing"
  // the real DOM after hydrate() mutated it.
  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!activeNoteId || activeNoteContent === null || !activeNoteData) {
        if (!cancelled) {
          if (headerRef.current) headerRef.current.innerHTML = '';
          if (bodyRef.current) bodyRef.current.innerHTML = '';
          setBodyVersion(v => v + 1);
        }
        return;
      }

      // Build the full NoteData object that renderView expects
      const noteData: NoteData = {
        id: activeNoteId,
        content: activeNoteContent,
        created_at: activeNoteData.created_at,
        updated_at: activeNoteData.updated_at,
        current: activeNoteData.current,
        created_by: activeNoteData.created_by,
        updated_by: activeNoteData.updated_by,
        meta: activeNoteData.meta,
      };

      try {
        const htmlStr = await renderView(activeNoteContent, noteData);

        if (cancelled) return;

        // Split <h1> for fixed header, rest goes to scrollable body
        const m = htmlStr.match(/^(<h1[^>]*>.*?<\/h1>)/);
        const headerHtml = m ? m[1] : '';
        const bodyHtmlStr = m ? htmlStr.slice(m[1].length) : htmlStr;

        // Write directly to the real DOM.  React does not track these
        // subtrees, so it will never reset them on re-render.
        if (headerRef.current) headerRef.current.innerHTML = headerHtml;
        if (bodyRef.current) {
          bodyRef.current.innerHTML = bodyHtmlStr;
          // Hydrate fence blocks (Mermaid, SVGBob, syntax highlighting)
          await hydrate(bodyRef.current);
        }

        if (cancelled) return;

        // Defer wikilink post-processing so it runs after hydration
        // has added .hljs markers (though the two target different
        // elements, the setTimeout keeps the code easy to reason about).
        setTimeout(() => {
          if (cancelled) return;
          if (bodyRef.current) {
            postProcessWikilinks(bodyRef.current).catch(err =>
              console.warn('[ViewTab] wikilink post-process failed:', err),
            );
          }
        }, 0);

        setBodyVersion(v => v + 1);
      } catch (err) {
        console.warn('[ViewTab] render failed:', err);
        if (!cancelled) {
          if (headerRef.current) headerRef.current.innerHTML = '';
          if (bodyRef.current) {
            bodyRef.current.innerHTML = '<p class="view-error">Failed to render note</p>';
          }
          setBodyVersion(v => v + 1);
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [activeNoteId, activeNoteContent, activeNoteData]);

  // ── Post-render: highlight full-text search matches ──
  //
  // Fires on content change (bodyVersion) or search query change.
  // Clears old highlights before applying new ones — since React no
  // longer resets the DOM, we must manage highlight state ourselves.
  useEffect(() => {
    if (!bodyRef.current) return;
    const q = (searchQuery || '').trim();

    // Clear existing highlights regardless — safe even without any.
    _clearHighlights(bodyRef.current);
    const header = headerRef.current;
    if (header) _clearHighlights(header);

    if (!q) return;

    // Defer so hydration + wikilink post-processing finish first.
    // The 50ms delay covers async hydration of lazy-loaded renderers.
    const timer = setTimeout(() => {
      if (!bodyRef.current) return;
      _highlightMatches(bodyRef.current, q);
      if (header) _highlightMatches(header, q);
    }, 50);
    return () => clearTimeout(timer);
  }, [bodyVersion, searchQuery]);

  // ── Wikilink click → load the linked note ──
  const handleWikilinkClick = useCallback(
    (e: React.MouseEvent) => {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-note]');
      if (!link) return;
      e.preventDefault();
      const id = link.dataset.note;
      if (id) loadNote(id).catch(err => console.warn('[ViewTab] wikilink load failed:', err));
    },
    [loadNote],
  );

  return (
    <>
      <div className="view-header" ref={headerRef} />
      <div
        className="view-content"
        ref={bodyRef}
        onClick={handleWikilinkClick}
      />
    </>
  );
}
