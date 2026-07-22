/**
 * useAutoSave.ts — Debounced auto-save hook.
 *
 * Phase 4d: watches activeNoteContent changes and schedules a save after
 *           the configured delay (SpaConfig.autosave.delay_ms).
 *           Respects the enabled flag and skips system notes.
 *           Integrates edit-time tracking — notes activity on every
 *           change, merges accumulated seconds into frontmatter on save.
 */

import { useEffect, useRef } from 'react';
import { useAppState } from '../state/AppContext.js';
import { useNotes } from './useNotes.js';
import { getAutosaveConfig } from '../config.js';
import { stripFrontmatterKey } from '../frontmatter.js';
import { noteEditActivity, mergeEditTime } from './useEditTime.js';

export function useAutoSave() {
  const { activeNoteId, activeNoteContent, isDirty, isSystemNote } = useAppState();
  const { saveNote } = useNotes();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNoteRef = useRef(saveNote);
  saveNoteRef.current = saveNote;
  const idRef = useRef(activeNoteId);
  idRef.current = activeNoteId;

  // Track last-saved content so we don't re-save unchanged content
  // after saveNote already marked isDirty=false.
  const lastSavedRef = useRef<string | null>(null);

  useEffect(() => {
    const cfg = getAutosaveConfig();

    // ── Edit-time: signal activity on every content change ──
    if (activeNoteContent !== null) {
      noteEditActivity();
    }

    // Nothing to do if auto-save is disabled, no note is open,
    // it's a system note, or there are no pending changes.
    if (!cfg.enabled || !activeNoteId || isSystemNote || !isDirty) return;

    // Strip edit-time before comparing so timer drift doesn't look like
    // a real content change (would cause spurious auto-saves).
    const contentBody = activeNoteContent
      ? stripFrontmatterKey(activeNoteContent, 'edit-time')
      : null;
    const lastBody = lastSavedRef.current
      ? stripFrontmatterKey(lastSavedRef.current, 'edit-time')
      : null;
    if (contentBody === lastBody) return;

    // Reset debounce timer on every content change.
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const id = idRef.current;
      const raw = activeNoteContent;
      if (!id || raw === null) return;

      // Merge accumulated edit-time seconds into frontmatter before saving.
      const content = mergeEditTime(raw);
      await saveNoteRef.current(id, content);
      lastSavedRef.current = content;
    }, cfg.delay_ms);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeNoteContent, activeNoteId, isDirty, isSystemNote]);

  // Cleanup on unmount — flush pending save.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
}
