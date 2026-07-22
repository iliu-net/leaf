/**
 * useNoteHistory.ts — browser URL history for note navigation.
 *
 * Maps ?note=id query param ↔ activeNoteId.  On mount, opens the note
 * specified in the URL (if any).  Subscribes to popstate for back/forward.
 * Pushes a new history entry when the active note changes.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../state/AppContext.js';
import { useNotes } from './useNotes.js';

function getNoteFromUrl(): string | null {
  return new URLSearchParams(location.search).get('note');
}

function pushNoteUrl(id: string): void {
  if (getNoteFromUrl() === id) return;
  const url = new URL(location.href);
  url.searchParams.set('note', id);
  history.pushState(null, '', url);
}

function clearNoteUrl(): void {
  if (!getNoteFromUrl()) return;
  const url = new URL(location.href);
  url.searchParams.delete('note');
  history.replaceState(null, '', url);
}

export function useNoteHistory() {
  const { activeNoteId, notes } = useAppState();
  const { loadNote } = useNotes();
  const prevNoteId = useRef<string | null>(null);

  // ── Boot: open note from URL (waits for notes to be available) ──
  const urlAttempted = useRef(false);

  useEffect(() => {
    const noteId = getNoteFromUrl();
    if (!noteId || urlAttempted.current) return;
    // Only attempt when the note appears in the list (may arrive
    // asynchronously after reset + sync downloads from server).
    if (!notes.some(n => n.id === noteId)) return;
    urlAttempted.current = true;
    loadNote(noteId).catch(err =>
      console.warn('[history] failed to load note from URL:', noteId, err),
    );
  }, [notes, loadNote]);

  // ── Sync URL when activeNoteId changes ──
  useEffect(() => {
    // Skip the initial render (prevNoteId starts null)
    if (prevNoteId.current === null) {
      prevNoteId.current = activeNoteId;
      return;
    }
    // Only push if the ID actually changed
    if (activeNoteId === prevNoteId.current) return;
    prevNoteId.current = activeNoteId;

    if (activeNoteId) {
      pushNoteUrl(activeNoteId);
    } else {
      clearNoteUrl();
    }
  }, [activeNoteId]);

  // ── Popstate: back/forward → load note from URL ──
  useEffect(() => {
    const onPopState = async () => {
      const noteId = getNoteFromUrl();
      if (noteId) {
        try {
          await loadNote(noteId);
        } catch {
          console.warn('[history] note not found:', noteId);
        }
      }
      // If URL has no ?note=, leave the current note open (don't clear)
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [loadNote]);

  return null;
}
