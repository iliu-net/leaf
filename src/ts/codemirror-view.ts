/**
 * codemirror-view.ts — CodeMirror TabPanel (View) implementation
 *
 * Implements the TabPanel contract so editor-ctrl.ts can treat the
 * CodeMirror editor uniformly alongside View, Raw, and Meta tabs.
 *
 * This module is *lightweight* — it imports NO @codemirror/* packages.
 * The heavy CM chunk (setup.ts) is injected via the init() factory
 * pattern, so the main bundle stays lean and the CM code is only
 * loaded when the dynamic import() in editor-ctrl.ts succeeds.
 *
 * Data flow:
 *   The hidden <textarea> remains the canonical source of truth.
 *   On show → parse frontmatter, feed body → CodeMirror.
 *   On every user change → merge body with frontmatter, write to
 *     textarea, dispatch note-changed (so dirty tracking works).
 *   On hide → no-op (textarea already up-to-date from live flush).
 */

import type { TabPanel, TabPanelContext } from './tab-panel.js';
import { parseFrontmatter } from './frontmatter.js';
import { DOM, $maybe } from './dom-ids.js';
import { setSpellcheckLang, resolveSpellcheckLang } from './codemirror/spellcheck.js';
import { getSpellcheckConfig } from './config.js';

// ── Minimal CM interfaces (no @codemirror/* import needed) ────────────────────

/** Slice of CodeMirror EditorView that codemirror-edit.ts needs. */
interface CMView {
  readonly state: { readonly doc: { toString(): string; readonly length: number } };
  dispatch(spec: { changes?: { from: number; to?: number; insert?: string } }): void;
  destroy(): void;
  readonly dom: HTMLElement;
  focus(): void;
}

/** Factory type — the function exported by codemirror/setup.ts. */
type CMFactory = (parent: Element, initialDoc: string, onChange: () => void) => CMView;

// ── State ─────────────────────────────────────────────────────────────────────

let _cmView: CMView | null = null;
let _createEditor: CMFactory | null = null;

/** Cache the textarea ref so we don't query the DOM on every keystroke. */
let _textarea: HTMLTextAreaElement | null = null;

/**
 * When true, the next call to _flushToTextarea is silently dropped.
 * Used to suppress spurious dirty marks during programmatic content sync
 * (e.g. when cmShow updates CM to match a changed textarea).
 */
let _suppressNextFlush = false;

// ── Spellcheck language change listener ──────────────────────────────────────

/**
 * When setSpellcheckLang() fires 'spellcheck-lang-changed', dispatch an
 * empty transaction to force the spellcheck ViewPlugin's update() so the
 * lang attribute is applied without waiting for the next keystroke.
 */
window.addEventListener('spellcheck-lang-changed', () => {
  _cmView?.dispatch({});
});

// ── Public API (called by editor-ctrl.ts) ─────────────────────────────────────

/**
 * Receive the CM factory from the dynamically-loaded chunk.
 * Called once after the import('./codemirror/setup.js') succeeds.
 */
export function init(factory: CMFactory): void {
  _createEditor = factory;
}

// ── Content merge helpers ─────────────────────────────────────────────────────

/**
 * Replace the body portion of raw content (after frontmatter) with new body.
 * Preserves any frontmatter block intact.
 */
function _replaceBody(rawContent: string, newBody: string): string {
  const m = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) return m[0] + newBody;
  return newBody;
}

/**
 * Write the current CM body into the hidden textarea (merged with frontmatter)
 * and dispatch note-changed so dirty tracking in app.ts picks it up.
 *
 * Skipped when _suppressNextFlush is true (programmatic content sync).
 */
function _flushToTextarea(): void {
  if (_suppressNextFlush) {
    _suppressNextFlush = false;
    return;
  }
  if (!_cmView) return;
  const body = _cmView.state.doc.toString();
  const ta = _textarea;
  if (!ta) return;
  const merged = _replaceBody(ta.value, body);
  ta.value = merged;
  ta.dispatchEvent(new CustomEvent('note-changed', { bubbles: true }));
}

// ── TabPanel implementation ───────────────────────────────────────────────────

/**
 * One-time setup: cache DOM refs.
 * (TabPanel contract — called by editor-ctrl.ts initPanels.)
 */
function cmInit(): void {
  _textarea = $maybe(DOM.NOTE_AREA) as HTMLTextAreaElement | null;
}

/**
 * Show / render the CodeMirror panel.
 *
 * Parses frontmatter from ctx.content, extracts the body, and loads it
 * into CodeMirror.  Creates the EditorView on first call; reuses it on
 * subsequent tab switches (just updates the document content).
 */
async function cmShow(ctx: TabPanelContext): Promise<void> {
  if (!_createEditor) return;

  const fm = parseFrontmatter(ctx.content);
  const parent = $maybe(DOM.TAB_CODE);
  if (!parent) return;

  // Resolve spellcheck language: frontmatter → SpaConfig → <html lang> → 'en-US'
  const fmLang = typeof fm.meta['lang'] === 'string' ? fm.meta['lang'] as string : undefined;
  const cfgDefault = getSpellcheckConfig().default_lang;
  const lang = resolveSpellcheckLang(fmLang, cfgDefault);
  setSpellcheckLang(lang);

  if (_cmView) {
    // Editor already exists — sync its content to match current textarea body.
    const currentBody = _cmView.state.doc.toString();
    if (currentBody !== fm.body) {
      _suppressNextFlush = true;
      _cmView.dispatch({
        changes: { from: 0, to: _cmView.state.doc.length, insert: fm.body },
      });
    }
  } else {
    // First show — create the editor. The initial doc set won't trigger
    // docChanged in the update listener, so no flush is fired.
    _cmView = _createEditor(parent, fm.body, _flushToTextarea);
  }
}

/**
 * Hide the CodeMirror panel.
 *
 * Textarea is already up-to-date from live flushing; this is a no-op
 * but included for the TabPanel contract.
 */
function cmHide(): void {
  /* textarea kept in sync by _flushToTextarea on every keystroke */
}

/** TabPanel contract — typed lens for editor-ctrl.ts registration. */
export const tabPanel: TabPanel = { init: cmInit, show: cmShow, hide: cmHide };
