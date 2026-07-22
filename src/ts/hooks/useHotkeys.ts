/**
 * useHotkeys.ts — Global keyboard shortcuts hook.
 *
 * Phase 4d: ref-based stable event listener for Ctrl+S/E/M.
 *           Register once on mount; reads all state via refs.
 */

import { useEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../state/AppContext.js';
import { useNotes } from './useNotes.js';
import { mergeEditTime } from './useEditTime.js';
import { parseFrontmatter } from '../frontmatter.js';

export function useHotkeys() {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const { saveNote } = useNotes();

  // Stash current values in refs so the single keydown listener
  // always reads the latest state without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveNoteRef = useRef(saveNote);
  saveNoteRef.current = saveNote;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const { activeNoteId, activeNoteContent, activeTab, isSystemNote } = stateRef.current;

      // ── Ctrl+S — save, then switch to View ──
      if (e.key === 's') {
        // No-op when nothing is open or already on View.
        if (!activeNoteId || activeTab === 'view') return;
        e.preventDefault();
        const id = activeNoteId;
        saveNoteRef.current(id, mergeEditTime(activeNoteContent ?? ''));
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'view' });
        dispatch({ type: 'ADD_TOAST', id: `save-${Date.now()}`, message: `Saved "${id}"` });
        dispatch({ type: 'SET_STATUS', status: `Saved "${id}"` });
        return;
      }

      // ── Ctrl+E — switch to Code tab, focus title if empty else CodeMirror ──
      if (e.key === 'e') {
        // On Code tab: let CodeMirror / browser handle it (e.g. Emmet).
        if (activeTab === 'code') return;
        e.preventDefault();
        if (!activeNoteId) return;
        // System notes don't have a Code tab.
        if (isSystemNote) return;

        if (activeTab === 'view' || activeTab === 'meta') {
          dispatch({ type: 'SET_ACTIVE_TAB', tab: 'code' });
          // After the DOM updates, focus the title input if no title is
          // set yet, otherwise place the cursor in CodeMirror.
          requestAnimationFrame(() => {
            const fm = parseFrontmatter(activeNoteContent ?? '');
            const title = typeof fm.meta['title'] === 'string' ? fm.meta['title'].trim() : '';
            if (!title) {
              document.getElementById('code-title')?.focus();
            } else {
              (document.querySelector('.cm-content') as HTMLElement | null)?.focus();
            }
          });
        }
        return;
      }

      // ── Ctrl+M — switch to Meta tab, focus title ──
      if (e.key === 'm') {
        e.preventDefault();
        if (!activeNoteId) return;
        if (activeTab === 'meta') {
          document.getElementById('meta-title')?.focus();
        } else {
          dispatch({ type: 'SET_ACTIVE_TAB', tab: 'meta' });
          requestAnimationFrame(() => {
            document.getElementById('meta-title')?.focus();
          });
        }
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dispatch]); // stable — state & saveNote read via refs
}
