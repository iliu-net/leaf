/**
 * setup.ts — CodeMirror 6 EditorView factory
 *
 * Creates a fully-configured EditorView with manually composed extensions
 * (no basicSetup — we pick each extension to keep the bundle lean).
 *
 * This module is the *heavy* chunk — all @codemirror/* imports live here
 * so that the dynamic import() in editor-ctrl.ts can load it lazily.
 * If the chunk is not in the SW cache the app falls back to raw textarea.
 */

import {
  EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  keymap, drawSelection, dropCursor, highlightSpecialChars,
  rectangularSelection, crosshairCursor,
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands';
import {
  foldGutter, foldKeymap, bracketMatching, indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';

import { highlightDark, highlightLight, resolveHighlight } from './highlight-themes.js';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { htmlLanguage } from '@codemirror/lang-html';
import { cssLanguage } from '@codemirror/lang-css';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { xmlLanguage } from '@codemirror/lang-xml';

import { spellcheckPlugin } from './spellcheck.js';
import { pasteHandler } from './paste-handler.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CMView {
  readonly state: { readonly doc: { toString(): string; readonly length: number } };
  dispatch(spec: { changes?: { from: number; to?: number; insert?: string } }): void;
  destroy(): void;
  readonly dom: HTMLElement;
  focus(): void;
}

export type CMFactory = (parent: Element, initialDoc: string, onChange: () => void) => CMView;

// ── Nested code-fence language map ────────────────────────────────────────────

/**
 * Resolve language names from markdown code fences to CodeMirror language
 * objects so that fenced blocks (```html, ```css, etc.) get proper
 * syntax highlighting inside the editor.
 */
function codeLanguages(info: string) {
  const name = info.split(/\s+/)[0].toLowerCase();
  switch (name) {
    case 'html': return htmlLanguage;
    case 'css': return cssLanguage;
    case 'js': case 'javascript': return javascriptLanguage;
    case 'xml': case 'svg': return xmlLanguage;
  }
  return null;
}

// ── Theme-switchable syntax compartment ───────────────────────────────────────

const syntaxCompartment = new Compartment();
let _activeCMView: EditorView | null = null;

/**
 * Reconfigure the syntax highlighting on the active CodeMirror editor.
 * Safe to call before CM is loaded (no-op if editor hasn't been created yet).
 * Exposed on window so ui.ts can call it without importing the heavy CM chunk.
 */
function setCMTheme(theme: string): void {
  if (!_activeCMView) return;
  _activeCMView.dispatch({
    effects: syntaxCompartment.reconfigure(
      syntaxHighlighting(resolveHighlight(theme)),
    ),
  });
}

// Install the global hook (lazy-loaded, so may appear after initial paint).
(window as any).__leafSetCMTheme = setCMTheme;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a CodeMirror 6 EditorView in `parent` with the given initial doc.
 *
 * @param parent      DOM element to mount the editor into.
 * @param initialDoc  Markdown body (no frontmatter) to load initially.
 * @param onChange    Called after every document change (for dirty tracking).
 */
export function createEditor(
  parent: Element,
  initialDoc: string,
  onChange: () => void,
): CMView {
  const extensions = [
    // ── Editing ──────────────────────────────────────────────────────────
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    rectangularSelection(),
    crosshairCursor(),
    indentOnInput(),

    // ── History ──────────────────────────────────────────────────────────
    history(),

    // ── Keybindings ──────────────────────────────────────────────────────
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...markdownKeymap,
      indentWithTab,
    ]),

    // ── Folding ──────────────────────────────────────────────────────────
    foldGutter(),

    // ── Bracket matching ─────────────────────────────────────────────────
    bracketMatching(),

    // ── Search highlight ─────────────────────────────────────────────────
    highlightSelectionMatches(),

    // ── Syntax highlighting (theme-switchable via Compartment) ──────────
    syntaxCompartment.of(
      syntaxHighlighting(resolveHighlight(
        document.documentElement.getAttribute('data-theme') || 'dark',
      )),
    ),

    // ── Markdown language (with nested code-fence highlighting) ──────────
    markdown({ codeLanguages }),

    // ── Spellcheck ───────────────────────────────────────────────────────
    spellcheckPlugin(),

    // ── Paste handling (turndown + image editor) ───────────────────────────
    pasteHandler,

    // ── Change notification ──────────────────────────────────────────────
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange();
    }),

    // ── Theme — matches app.css tokens ───────────────────────────────────
    EditorView.theme({
      '&': {
        fontSize: 'var(--fs-mono)',
        lineHeight: '1.8',
        width: '100%',
        height: '100%',
        maxWidth: '800px',
        margin: '0 auto',
        backgroundColor: 'var(--bg)',
        color: 'var(--text-1)',
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        overflow: 'auto',
        padding: '28px 0',
      },
      '.cm-content': {
        caretColor: 'var(--accent)',
        fontFamily: 'var(--font-mono)',
        padding: '0 36px',
        minHeight: '100%',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--accent)',
        borderLeftWidth: '3px',
      },
      '.cm-gutters': {
        borderRight: '1px solid var(--border-mid)',
        backgroundColor: 'var(--bg)',
        color: 'var(--text-3)',
        fontFamily: 'var(--font-mono)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--bg-active)',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--bg-active)',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: 'var(--bg-2)',
        color: 'var(--text-3)',
        border: '1px solid var(--border-mid)',
        borderRadius: '3px',
        padding: '0 4px',
      },
      '.cm-selectionMatch': {
        backgroundColor: 'var(--accent-glow)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'var(--accent-glow)',
        outline: '1px solid var(--accent-dim)',
      },
    }),
  ];

  const view = new EditorView({
    state: EditorState.create({ doc: initialDoc, extensions }),
    parent,
  });

  _activeCMView = view;

  return view;
}
