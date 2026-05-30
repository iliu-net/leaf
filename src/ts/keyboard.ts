/**
 * keyboard.ts — global keyboard shortcuts
 *
 * Ctrl+S, Ctrl+E, Ctrl+M handlers extracted from ui.ts.  Depends on the
 * editor controller for tab switching and on a save callback supplied by
 * the caller (app.ts).
 */

import * as editor from './editor-ctrl.js';

/**
 * Install global keyboard shortcut listeners.
 * @param onSave  Called for Ctrl+S — triggers save + toast from app.ts.
 */
export function init(onSave: () => void): void {
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    // ── CTRL+S — save, then switch to view (no-op on VIEW tab) ─────────
    if (e.key === 's') {
      e.preventDefault();
      if (editor.getActiveTab() === 'view') return;  // VIEW: no-op
      onSave();
      editor.switchEditorTab('view');
      return;
    }

    // ── CTRL+E — toggle edit/view (pass-through on CODE tab) ───────────
    if (e.key === 'e') {
      const active = editor.getActiveTab();
      // On CODE tab: let the browser / CodeMirror handle it
      if (active === 'code') return;

      e.preventDefault();
      if (!editor.getCurrentNoteId()) return;

      if (active === 'view' || active === 'meta') {
        // → CODE (if CM available) or RAW
        editor.switchEditorTab(editor.isCmAvailable() ? 'code' : 'raw');
      } else {
        // active === 'raw' → VIEW
        editor.switchEditorTab('view');
      }
      return;
    }

    // ── CTRL+M — switch to META tab ────────────────────────────────────
    if (e.key === 'm') {
      e.preventDefault();
      if (!editor.getCurrentNoteId()) return;
      if (editor.getActiveTab() === 'meta') {
        // Already on META — re-focus the title field
        editor.focusActiveTab();
      } else {
        editor.switchEditorTab('meta');
      }
      return;
    }
  });
}
