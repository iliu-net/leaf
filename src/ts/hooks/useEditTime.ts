/**
 * useEditTime.ts — Edit-time tracking hook.
 *
 * Phase 4d: wires the existing edit-time singleton module into the React
 *           lifecycle.  Calls start() when a note is opened, noteActivity()
 *           on every content change, and stop() on unmount / note close.
 *
 * Edit-time seconds are persisted into frontmatter under the reserved
 * key "edit-time" ONLY alongside real content saves (never alone).
 */

import { useEffect } from 'react';
import { useAppState } from '../state/AppContext.js';
import * as editTime from '../edit-time.js';
import { getEditTimeConfig } from '../config.js';
import { updateFrontmatter } from '../frontmatter.js';

export function useEditTime() {
  const { activeNoteId, activeNoteData } = useAppState();

  // ── Start / stop tracking when the active note changes ──
  useEffect(() => {
    if (activeNoteId && activeNoteData) {
      const etRaw = activeNoteData.meta?.['edit-time'];
      const existingSec = typeof etRaw === 'string' ? parseInt(etRaw, 10) || 0 : 0;
      editTime.start(activeNoteId, existingSec, getEditTimeConfig().inactivity_sec);
    } else {
      editTime.stop();
    }
    return () => {
      editTime.stop();
    };
  }, [activeNoteId, activeNoteData]);
}

/**
 * Signal user activity — call on every keystroke or meta-field change.
 * Resets the inactivity timer.
 */
export function noteEditActivity(): void {
  editTime.noteActivity();
}

/**
 * Merge current edit-time seconds into content frontmatter.
 * Returns the same string if no time has accumulated.
 *
 * Call this before saving.  Does NOT modify edit-time state.
 */
export function mergeEditTime(content: string): string {
  const et = editTime.getCurrentSeconds();
  if (et > 0) {
    return updateFrontmatter(content, { 'edit-time': String(et) });
  }
  return content;
}
