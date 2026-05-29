/**
 * spellcheck.ts — browser-native spellcheck ViewPlugin for CodeMirror 6
 *
 * Walks the editor's content DOM after each view update and sets
 * spellcheck="true" + lang="xx" on text-bearing elements.  Relies
 * entirely on the browser's built-in spellchecker — no external
 * dictionary needed.  Zero dependencies beyond @codemirror/view.
 *
 * Language resolution (in priority order):
 *   1. Note frontmatter `lang` key
 *   2. SpaConfig.spellcheck.default_lang
 *   3. document.documentElement.lang  (the <html lang> attribute)
 *   4. 'en-US' (hardcoded fallback)
 *
 * Language is set dynamically via setSpellcheckLang() — typically
 * called when a note is opened or its frontmatter `lang` changes.
 * A 'spellcheck-lang-changed' custom event is fired so the CM view
 * can force a plugin update without waiting for the next keystroke.
 */

import { ViewPlugin } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';

// ── Module-level language state ────────────────────────────────────────────────

let _currentLang: string = document.documentElement.lang || 'en-US';

/** Return the active spellcheck language tag (e.g. 'en-US', 'es'). */
export function getSpellcheckLang(): string {
  return _currentLang;
}

/**
 * Switch the spellcheck language at runtime.
 *
 * Fires a 'spellcheck-lang-changed' custom event on window so the
 * CodeMirror view can force a plugin update.
 */
export function setSpellcheckLang(lang: string): void {
  if (!lang || lang === _currentLang) return;
  _currentLang = lang;
  window.dispatchEvent(new CustomEvent('spellcheck-lang-changed', { detail: lang }));
}

/**
 * Resolve a spellcheck language from the three-tier fallback chain.
 *
 * @param fmLang        `lang` value from note frontmatter (if any)
 * @param configDefault default_lang from SpaConfig (if any)
 */
export function resolveSpellcheckLang(
  fmLang: string | undefined,
  configDefault: string | undefined,
): string {
  return fmLang || configDefault || document.documentElement.lang || 'en-US';
}

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
        _apply(view, _currentLang);
      }

      update(update: ViewUpdate) {
        // Always re-apply — setAttribute on already-correct values is a
        // cheap no-op, and this guarantees language changes are picked up
        // even when triggered by an empty dispatch().
        _apply(update.view, _currentLang);
      }

      destroy() {
        /* no explicit cleanup needed */
      }
    },
  );
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _apply(view: EditorView, lang: string): void {
  const dom = view.contentDOM;
  if (!dom) return;

  // Set spellcheck + lang on the content wrapper itself
  if (dom instanceof HTMLElement) {
    dom.setAttribute('spellcheck', 'true');
    dom.setAttribute('lang', lang);
  }

  // Walk every line element — CM may override spellcheck on individual lines.
  // We set both attributes so the browser dictionary follows correctly.
  for (const el of dom.querySelectorAll('.cm-line')) {
    const line = el as HTMLElement;
    line.setAttribute('spellcheck', 'true');
    line.setAttribute('lang', lang);
  }
}
