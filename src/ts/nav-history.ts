/**
 * nav-history.ts — note navigation back-button stack
 *
 * Tracks visited note IDs so the back button can navigate to the
 * previously viewed note.  Extracted from app.ts to keep the entry
 * point focused on boot orchestration.
 */

import { DOM, $maybe } from './dom-ids.js';

// ── State ──────────────────────────────────────────────────────────────────

/** Stack of previously visited note IDs (most recent last). */
const _history: string[] = [];
const MAX_HISTORY = 50;

// ── Public API ─────────────────────────────────────────────────────────────

/** Push a note ID onto the history stack. Skips if same as top. */
export function push(id: string): void {
  if (_history.length > 0 && _history[_history.length - 1] === id) return;
  _history.push(id);
  if (_history.length > MAX_HISTORY) _history.shift();
  _updateButton();
}

/**
 * Pop and return the previous note ID, or null if no history.
 * Removes two entries: the current (top) and the previous one
 * (which will be pushed again when opened by the caller).
 */
export function pop(): string | null {
  if (_history.length === 0) return null;
  _history.pop(); // discard current
  if (_history.length === 0) {
    _updateButton();
    return null;
  }
  const prev = _history[_history.length - 1];
  _history.pop(); // also remove previous (re-pushed when opened)
  _updateButton();
  return prev;
}

/** Remove all occurrences of a note ID from the history (e.g. after delete). */
export function remove(id: string): void {
  while (_history.includes(id)) {
    const idx = _history.indexOf(id);
    _history.splice(idx, 1);
  }
  _updateButton();
}

// ── Internal ───────────────────────────────────────────────────────────────

/** Update the back button's enabled/disabled state. */
function _updateButton(): void {
  const btn = $maybe(DOM.BTN_BACK) as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = _history.length <= 1;
}
