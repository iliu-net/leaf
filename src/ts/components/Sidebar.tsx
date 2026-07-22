/**
 * Sidebar.tsx — Note list sidebar with search, mode switching, and resizer.
 *
 * Phase 3: full interactive sidebar — wired to AppContext, useNotes/useTrash
 * hooks.  Renders NoteTree in notes mode, placeholders for trash/tags.
 * Search filters the note list with debounce.  Enter triggers full-text search.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppState, useAppDispatch } from '../state/AppContext.js';
import { useNotes } from '../hooks/useNotes.js';
import { useTrash } from '../hooks/useTrash.js';
import { useConfirm } from '../hooks/useConfirm.js';
import NoteTree from './NoteTree.js';
import TrashView from './TrashView.js';
import TagView from './TagView.js';
import type { FullTextResult } from '../notes.js';

/* ── Debounce hook ── */

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ── Sidebar ── */

export interface SidebarProps {
  /** Open the new-note / rename modal. */
  onOpenModal: (mode: 'create' | 'rename', noteId?: string, searchValue?: string) => void;
  /** Logout (called from app menu). */
  onLogout: () => void;
  /** Handle database reset. */
  onResetDB: () => void;
}

export default function Sidebar({ onOpenModal, onLogout, onResetDB }: SidebarProps) {
  const dispatch = useAppDispatch();
  const { sidebarMode, searchQuery, notes, activeNoteId, trash, syncStatus } = useAppState();
  const { fullTextSearch, refreshList, deleteNote, renameNote, loadNote, saveNote, activeNoteContent, activeNoteId: noteId } = useNotes();
  const { restoreItem, purgeItem, emptyAll, refreshTrashList, getContent } = useTrash();
  const { confirm } = useConfirm();

  // Search state (local)
  const [searchResults, setSearchResults] = useState<FullTextResult[] | null>(null);
  const [trashSearch, setTrashSearch] = useState('');
  const debouncedQuery = useDebounce(searchQuery, 250);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Trash filtered counts for footer
  const trashFiltered = useMemo(() => {
    const q = trashSearch.trim().toLowerCase();
    if (!q) return trash;
    return trash.filter(e => e.id.toLowerCase().includes(q));
  }, [trash, trashSearch]);

  // Clear full-text results when query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults(null);
    }
  }, [debouncedQuery]);

  // Reset search state when entering trash mode
  useEffect(() => {
    if (sidebarMode === 'trash') {
      dispatch({ type: 'SET_SEARCH_QUERY', query: '' });
      setSearchResults(null);
      setTrashSearch('');
    }
  }, [sidebarMode, dispatch]);

  // Auto-hide sidebar on mobile when a different note is selected
  const prevNoteRef = useRef(activeNoteId);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile && activeNoteId && activeNoteId !== prevNoteRef.current) {
      document.getElementById('app')?.classList.remove('sidebar-open');
    }
    prevNoteRef.current = activeNoteId;
  }, [activeNoteId]);

  // ── Handlers ──

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_SEARCH_QUERY', query: e.target.value });
  }, [dispatch]);

  const handleSearchKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && searchQuery) {
      e.preventDefault();
      dispatch({ type: 'SET_SEARCH_QUERY', query: '' });
      setSearchResults(null);
      if (searchInputRef.current) searchInputRef.current.value = '';
      return;
    }
    if (e.key === 'Enter' && searchQuery.trim()) {
      e.preventDefault();
      const results = await fullTextSearch(searchQuery.trim());
      setSearchResults(results);
    }
  }, [searchQuery, dispatch, fullTextSearch]);

  const handleNew = useCallback(() => {
    onOpenModal('create', undefined, searchQuery);
  }, [onOpenModal, searchQuery]);

  const handleOpenNote = useCallback(async (id: string) => {
    // Save any pending changes on the currently open note
    if (noteId && activeNoteContent !== null) {
      await saveNote(noteId, activeNoteContent);
    }
    // Clear search when opening a note from the tree view (filter mode),
    // but keep the query + results when opening from full-text search
    // so the user stays in the results list and highlighting remains active.
    if (searchQuery && !searchResults) {
      dispatch({ type: 'SET_SEARCH_QUERY', query: '' });
    }
    // Load the selected note
    try {
      await loadNote(id);
    } catch {
      // Note may not exist — handled by the hook
    }
  }, [noteId, activeNoteContent, searchQuery, searchResults, dispatch, saveNote, loadNote]);

  const handleDeleteNote = useCallback(async (id: string) => {
    await deleteNote(id);
  }, [deleteNote]);

  const handleRenameNote = useCallback((id: string) => {
    onOpenModal('rename', id);
  }, [onOpenModal]);

  const handleToggleTags = useCallback(() => {
    if (sidebarMode === 'tags') {
      dispatch({ type: 'SET_SIDEBAR_MODE', mode: 'notes' });
    } else {
      dispatch({ type: 'SET_SIDEBAR_MODE', mode: 'tags' });
    }
  }, [sidebarMode, dispatch]);

  const handleEmptyTrash = useCallback(async () => {
    const ok = await confirm({
      title: 'Empty trash',
      message: 'Permanently delete ALL items in trash?',
      confirmLabel: 'Delete all',
      variant: 'danger',
    });
    if (!ok) return;
    await emptyAll();
    await refreshTrashList();
    dispatch({ type: 'ADD_TOAST', id: `empty-${Date.now()}`, message: 'Trash emptied' });
    dispatch({ type: 'SET_STATUS', status: 'Trash emptied' });
  }, [confirm, emptyAll, refreshTrashList, dispatch]);

  const handleTrashRestore = useCallback(async (id: string, source: 'local' | 'server') => {
    await restoreItem(id, source);
    await refreshTrashList();
    await refreshList();
    dispatch({ type: 'CLEAR_TRASH_PREVIEW' });
    dispatch({ type: 'SET_SIDEBAR_MODE', mode: 'notes' });
    // Load the restored note into the editor
    try { await loadNote(id); } catch { /* may not exist yet */ }
    dispatch({ type: 'ADD_TOAST', id: `restore-${Date.now()}`, message: `Restored "${id}"` });
    dispatch({ type: 'SET_STATUS', status: `Restored "${id}"` });
  }, [restoreItem, refreshTrashList, refreshList, loadNote, dispatch]);

  const handleTrashPreview = useCallback(async (id: string, source: 'local' | 'server') => {
    const result = await getContent(id, source);
    if (!result) {
      dispatch({ type: 'ADD_TOAST', id: `preview-${Date.now()}`, message: 'Content not available', isError: true });
      return;
    }
    dispatch({
      type: 'SHOW_TRASH_PREVIEW',
      id,
      content: result.content,
      source,
      meta: {
        created_at: result.created_at,
        updated_at: result.updated_at,
        created_by: result.created_by,
        updated_by: result.updated_by,
        current: result.current,
      },
    });
  }, [getContent, dispatch]);

  const handleTrashPurge = useCallback(async (id: string, source: 'local' | 'server' | 'both') => {
    const ok = await confirm({
      title: 'Delete forever',
      message: `Permanently delete "${id}"? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      variant: 'danger',
    });
    if (!ok) return;
    await purgeItem(id, source);
    await refreshTrashList();
    dispatch({ type: 'CLEAR_TRASH_PREVIEW' });
    dispatch({ type: 'ADD_TOAST', id: `purge-${Date.now()}`, message: `Permanently deleted "${id}"` });
    dispatch({ type: 'SET_STATUS', status: `Permanently deleted "${id}"` });
  }, [confirm, purgeItem, refreshTrashList, dispatch]);

  // ── Counts ──

  const displayNoteCount = searchResults
    ? searchResults.length
    : notes.length;
  const noteCount = notes.length;
  const trashCount = trash.length;
  const trashShown = trashFiltered.length;

  // ── Is syncing? ──
  const isLoading = syncStatus === 'SYNCING';

  return (
    <aside id="sidebar" aria-label="Note list">
      {/* ── Notes toolbar (visible in notes/tags mode) ── */}
      <div id="sidebar-toolbar" style={{ display: sidebarMode === 'trash' ? 'none' : 'flex' }}>
        <div id="search-wrap">
          <svg width="13" height="13" fill="none" stroke="currentColor"
               strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={searchInputRef}
            id="search"
            type="search"
            placeholder="Filter…"
            aria-label="Filter notes"
            autoComplete="off"
            spellCheck={false}
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        <button id="btn-new" className="btn" title="New note" onClick={handleNew}>
          <svg width="13" height="13" fill="none" stroke="currentColor"
               strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New
        </button>
      </div>

      {/* ── Trash toolbar (visible in trash mode) ── */}
      <div id="trash-toolbar" style={{ display: sidebarMode === 'trash' ? 'flex' : 'none' }}>
        <svg className="trash-toolbar-icon" width="14" height="14" fill="none"
             stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>
        </svg>
        <div id="trash-search-wrap">
          <input id="trash-search" type="search" placeholder="Filter…"
                 aria-label="Filter trash" autoComplete="off" spellCheck={false}
                 value={trashSearch}
                 onChange={e => setTrashSearch(e.target.value)} />
        </div>
      </div>

      {/* ── Content area ── */}
      {sidebarMode === 'notes' ? (
        searchResults ? (
          <SearchResultsList results={searchResults} activeNoteId={activeNoteId} onOpen={handleOpenNote} />
        ) : (
          <NoteTree
            onOpen={handleOpenNote}
            onDelete={handleDeleteNote}
            onRename={handleRenameNote}
            searchQuery={searchQuery}
          />
        )
      ) : sidebarMode === 'trash' ? (
        <TrashView
          entries={trash}
          searchQuery={trashSearch}
          onRestore={handleTrashRestore}
          onPurge={handleTrashPurge}
          onPreview={handleTrashPreview}
        />
      ) : (
        <TagView
          notes={notes}
          activeNoteId={activeNoteId}
          searchQuery={searchQuery}
          onOpen={handleOpenNote}
        />
      )}

      {/* ── Loading indicator ── */}
      {isLoading && (
        <div id="sidebar-loading" aria-live="polite" aria-label="Loading notes">
          <div className="sidebar-spinner" aria-hidden="true"></div>
          <span>Syncing notes…</span>
        </div>
      )}

      {/* ── Notes footer ── */}
      <div id="sidebar-footer" style={{ display: sidebarMode === 'trash' ? 'none' : '' }}>
        <span id="note-count" aria-live="polite">
          {searchResults
            ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`
            : `${noteCount} note${noteCount !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* ── Trash footer ── */}
      <div id="trash-footer" style={{ display: sidebarMode === 'trash' ? 'flex' : 'none' }}>
        <span id="trash-item-count">
          {trashShown === trashCount
            ? `${trashCount} item${trashCount !== 1 ? 's' : ''}`
            : `${trashShown} / ${trashCount}`}
        </span>
        <button id="btn-empty-trash" className="btn-small danger"
                onClick={handleEmptyTrash} disabled={trashCount === 0}>
          Empty trash
        </button>
      </div>
    </aside>
  );
}

/* ── Search results list ── */

function SearchResultsList({ results, activeNoteId, onOpen }: { results: FullTextResult[]; activeNoteId: string | null; onOpen: (id: string) => void }) {
  if (results.length === 0) {
    return (
      <div id="file-list" role="list" aria-label="Search results">
        <div
          style={{
            padding: '20px 12px',
            textAlign: 'center',
            fontSize: '11px',
            color: 'var(--text-3)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          No results found
        </div>
      </div>
    );
  }

  return (
    <div id="file-list" role="list" aria-label="Search results">
      {results.map(r => (
        <div
          key={r.id}
          className={`file-item${r.id === activeNoteId ? ' active' : ''}`}
          data-id={r.id}
          role="listitem"
          onClick={() => onOpen(r.id)}
        >
          <svg
            className="file-item-icon"
            width="12" height="12" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24" aria-hidden="true"
          >
            <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
          </svg>
          <div className="file-item-text">
            <span className="file-item-name" title={r.id}>{r.id}</span>
            <span className="file-item-snippet">{r.snippet}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
