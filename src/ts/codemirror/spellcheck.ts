/**
 * spellcheck.ts — browser-native spellcheck ViewPlugin for CodeMirror 6
 *
 * Walks the editor's content DOM after each view update and adds
 * spellcheck="true" to text-bearing elements.  Relies entirely on the
 * browser's built-in spellchecker — no external dictionary needed.
 * Zero dependencies beyond @codemirror/view.
 */

import { ViewPlugin } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';

/**
 * View-plugin that enables browser spellcheck on the editor content DOM.
 *
 * CM6 disables spellcheck by default on its contentEditable area.  This
 * plugin re-enables it on `.cm-content` and all `.cm-line` descendants
 * so the browser's built-in spellchecker can underline misspelled words.
 */
export const spellcheckPlugin = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      _apply(view);
    }

    update(update: ViewUpdate) {
      // Re-apply when the document content or visible viewport changes,
      // because CM may re-create DOM nodes for lines.
      if (update.docChanged || update.viewportChanged) {
        _apply(update.view);
      }
    }

    destroy() {
      /* no explicit cleanup needed */
    }
  },
);

// ── Internal ──────────────────────────────────────────────────────────────────

function _apply(view: EditorView): void {
  const dom = view.contentDOM;
  if (!dom) return;

  // Set spellcheck on the content wrapper itself
  if (dom instanceof HTMLElement) {
    dom.setAttribute('spellcheck', 'true');
  }

  // Walk every line element — CM may override spellcheck on individual lines
  for (const el of dom.querySelectorAll('.cm-line')) {
    (el as HTMLElement).setAttribute('spellcheck', 'true');
  }
}
