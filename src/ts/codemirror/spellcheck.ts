/**
 * spellcheck.ts — browser-native spellcheck ViewPlugin for CodeMirror 6
 *
 * Walks the editor's content DOM after each view update and sets
 * spellcheck="true".  Relies entirely on the browser's built-in
 * spellchecker — no external dictionary needed.  Zero dependencies
 * beyond @codemirror/view.
 *
 */

import { ViewPlugin } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';

// ── Plugin factory ────────────────────────────────────────────────────────────

/**
 * Create a spellcheck ViewPlugin.
 *
 * Reads language from the module-level `_currentLang` variable, which
 * can be changed at any time via setSpellcheckLang().
 */
export function spellcheckPlugin() {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        _apply(view);
      }

      update(update: ViewUpdate) {
        // Always re-apply — setAttribute on already-correct values is a
        // cheap no-op, and this guarantees language changes are picked up
        // even when triggered by an empty dispatch().
        _apply(update.view);
      }

      destroy() {
        /* no explicit cleanup needed */
      }
    },
  );
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _apply(view: EditorView): void {
  const dom = view.contentDOM;
  if (!dom) return;

  // Set spellcheck + lang on the content wrapper itself
  if (dom instanceof HTMLElement) {
    dom.setAttribute('spellcheck', 'true');
  }

  // Walk every line element — CM may override spellcheck on individual lines.
  // We set both attributes so the browser dictionary follows correctly.
  for (const el of dom.querySelectorAll('.cm-line')) {
    const line = el as HTMLElement;
    line.setAttribute('spellcheck', 'true');
  }
}
