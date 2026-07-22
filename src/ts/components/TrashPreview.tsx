/**
 * TrashPreview.tsx — Read-only preview of a deleted note in the editor area.
 *
 * Shows a banner bar with the note ID, Restore and Purge buttons, and the
 * rendered markdown content below.  Replaces the normal editor tabs while
 * a trash item is being previewed.
 */

import { useState, useEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../state/AppContext.js';
import { useTrash } from '../hooks/useTrash.js';
import { useNotes } from '../hooks/useNotes.js';
import { useConfirm } from '../hooks/useConfirm.js';
import { renderView, postProcessWikilinks } from '../markdown-view.js';
import { hydrate } from '../fence-hydrate.js';
import type { NoteData } from '../notes.js';

export default function TrashPreview() {
  const dispatch = useAppDispatch();
  const { trashPreview } = useAppState();
  const { restoreItem, purgeItem, refreshTrashList } = useTrash();
  const { refreshList, loadNote } = useNotes();
  const { confirm } = useConfirm();

  const [html, setHtml] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // ── Render markdown ──
  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!trashPreview) return;

      const noteData: NoteData = {
        id: trashPreview.id,
        content: trashPreview.content,
        created_at: trashPreview.meta.created_at ?? 0,
        updated_at: trashPreview.meta.updated_at ?? 0,
        current: trashPreview.meta.current ?? '',
        created_by: trashPreview.meta.created_by ?? '',
        updated_by: trashPreview.meta.updated_by ?? '',
        meta: {},
      };

      try {
        const htmlStr = await renderView(trashPreview.content, noteData);
        if (!cancelled) setHtml(htmlStr);
      } catch (err) {
        console.warn('[TrashPreview] render failed:', err);
        if (!cancelled) setHtml('<p class="view-error">Failed to render preview</p>');
      }
    }

    render();
    return () => { cancelled = true; };
  }, [trashPreview]);

  // ── Post-render: hydrate fenced code blocks ──
  useEffect(() => {
    if (html && bodyRef.current) {
      const raf = requestAnimationFrame(() => {
        hydrate(bodyRef.current!).catch(err =>
          console.warn('[TrashPreview] hydrate failed:', err),
        );
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [html]);

  // ── Post-render: resolve wikilink titles, mark missing links ──
  useEffect(() => {
    if (html && bodyRef.current) {
      const raf = requestAnimationFrame(() => {
        postProcessWikilinks(bodyRef.current!).catch(err =>
          console.warn('[TrashPreview] wikilink post-process failed:', err),
        );
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [html]);

  // ── Actions ──

  const handleRestore = async () => {
    if (!trashPreview) return;
    await restoreItem(trashPreview.id, trashPreview.source);
    await refreshTrashList();
    await refreshList();
    dispatch({ type: 'CLEAR_TRASH_PREVIEW' });
    dispatch({ type: 'SET_SIDEBAR_MODE', mode: 'notes' });
    // Load the restored note into the editor
    try { await loadNote(trashPreview.id); } catch { /* may not exist yet */ }
    dispatch({ type: 'ADD_TOAST', id: `restore-${Date.now()}`, message: `Restored "${trashPreview.id}"` });
    dispatch({ type: 'SET_STATUS', status: `Restored "${trashPreview.id}"` });
  };

  const handlePurge = async () => {
    if (!trashPreview) return;
    const ok = await confirm({
      title: 'Delete forever',
      message: `Permanently delete "${trashPreview.id}"? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      variant: 'danger',
    });
    if (!ok) return;
    await purgeItem(trashPreview.id, trashPreview.source);
    await refreshTrashList();
    dispatch({ type: 'CLEAR_TRASH_PREVIEW' });
    dispatch({ type: 'ADD_TOAST', id: `purge-${Date.now()}`, message: `Permanently deleted "${trashPreview.id}"` });
    dispatch({ type: 'SET_STATUS', status: `Permanently deleted "${trashPreview.id}"` });
  };

  if (!trashPreview) return null;

  return (
    <div id="trash-banner">
      <div className="trash-banner-bar">
        <svg width="14" height="14" fill="none"
             stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
             aria-hidden="true">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>
        </svg>
        <span id="trash-banner-title">
          &ldquo;{trashPreview.id}&rdquo; is in the trash
        </span>
        <button id="trash-banner-restore" className="btn-small" onClick={handleRestore}>
          Restore
        </button>
        <button id="trash-banner-purge" className="btn-small danger" onClick={handlePurge}>
          Delete forever
        </button>
      </div>
      <div
        id="trash-banner-body"
        ref={bodyRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
