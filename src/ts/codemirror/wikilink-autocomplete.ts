/**
 * wikilink-autocomplete.ts — CodeMirror autocomplete for [[WikiLinks]]
 *
 * When the user types `[[` inside the CodeMirror editor, a completion
 * dialog appears listing all available note IDs (sourced from IndexedDB
 * plus the system-note registry).  The list filters as the user continues
 * typing after `[[`.
 *
 * Completion is scoped to the *target* part of the wikilink:
 *   [[tar…   → autocomplete fires (before `|` or `]`)
 *   [[tar|…   → autocomplete does NOT fire (we're in the label part)
 */

import { autocompletion, type CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete';
import { dbListNotes } from '../db.js';
import { listSystemNotes } from '../system-notes/registry.js';

// ── Regex ──────────────────────────────────────────────────────────────────

/**
 * Match [[ followed by characters that are NOT `]`, `|`, or `#` —
 * i.e. we are still typing the page-name portion of a wikilink.
 *
 * Group 1 = the partial page name (everything after `[[`).
 * The `$` anchors at the cursor position so we don't match if the
 * cursor is after a closing `]]`.
 */
const WIKILINK_BEFORE = /^\[\[([^\]|#]*)$/;

// ── Completion source ──────────────────────────────────────────────────────

/** In-memory cache of note IDs so we don't hit IndexedDB on every keystroke. */
let _cachedNoteIds: string[] | null = null;
let _cacheStamp = 0;

/**
 * Refresh the local cache of available note IDs.
 *
 * Called on every completion activation so the list stays current even
 * if the user creates/deletes notes in another tab.
 */
async function refreshCache(): Promise<string[]> {
  // Throttle refreshes to once per second.
  const now = Date.now();
  if (_cachedNoteIds && now - _cacheStamp < 1000) return _cachedNoteIds;

  const dbNotes = await dbListNotes();
  const sysNotes = listSystemNotes();
  const ids = new Set<string>();
  for (const n of dbNotes) ids.add(n.id);
  for (const n of sysNotes) ids.add(n.id);
  _cachedNoteIds = Array.from(ids).sort();
  _cacheStamp = now;
  return _cachedNoteIds;
}

/**
 * Completion source invoked by CodeMirror's autocompletion system.
 *
 * Returns null when the cursor is not inside a `[[…` wikilink context,
 * so the default completion behaviour (e.g. word completion) is unaffected.
 */
async function wikilinkSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const match = ctx.matchBefore(WIKILINK_BEFORE);
  if (!match) return null;

  const partial = match.text.slice(2);       // everything after [[
  const allIds = await refreshCache();

  // If the user hasn't typed anything after [[, show all notes.
  // Otherwise filter case-insensitively.
  const lower = partial.toLowerCase();
  const matches = partial
    ? allIds.filter(id => id.toLowerCase().includes(lower))
    : allIds;

  if (matches.length === 0) return null;

  const options: Completion[] = matches.map(id => ({
    label: id,
    type: 'text',
    // `apply` replaces from `[[` (match.from) to the cursor (match.to)
    // with the full wikilink syntax.  The cursor ends up just after `]]`.
    apply: `[[${id}]]`,
  }));

  return { from: match.from, options, filter: false };
}

// ── Exported extension ─────────────────────────────────────────────────────

/**
 * CodeMirror extension that adds [[WikiLink]] autocomplete.
 *
 * Usage in setup.ts:
 *   import { wikilinkAutocomplete } from './wikilink-autocomplete.js';
 *   // … inside extensions array:
 *   wikilinkAutocomplete,
 */
export const wikilinkAutocomplete = autocompletion({
  override: [wikilinkSource],
  // Only activate on typing (the override source checks the context).
  // The user can also trigger manually with Ctrl+Space.
  activateOnTyping: true,
  // Show at most 20 completions to avoid overflowing the viewport.
  // The list scrolls if there are more matches.
  maxRenderedOptions: 20,
});
