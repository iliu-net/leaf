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
  syntaxHighlighting, StreamLanguage,
} from '@codemirror/language';

import { highlightDark, highlightLight, resolveHighlight } from './highlight-themes.js';
import {
  searchKeymap, highlightSelectionMatches, openSearchPanel, SearchQuery, setSearchQuery,
} from '@codemirror/search';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { htmlLanguage } from '@codemirror/lang-html';
import { cssLanguage } from '@codemirror/lang-css';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { xmlLanguage } from '@codemirror/lang-xml';
import { jsonLanguage } from '@codemirror/lang-json';
import { pythonLanguage } from '@codemirror/lang-python';
import { javaLanguage } from '@codemirror/lang-java';
import { cppLanguage } from '@codemirror/lang-cpp';
import { phpLanguage } from '@codemirror/lang-php';

// Legacy (CodeMirror 5) modes — wrapped via StreamLanguage
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml as yamlMode } from '@codemirror/legacy-modes/mode/yaml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { tcl } from '@codemirror/legacy-modes/mode/tcl';
import { vb } from '@codemirror/legacy-modes/mode/vb';

import { spellcheckPlugin } from './spellcheck.js';
import { pasteHandler } from './paste-handler.js';
import { wikilinkAutocomplete } from './wikilink-autocomplete.js';

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
    // ── Official language packages ───────────────────────────────────────
    case 'html': return htmlLanguage;
    case 'css': return cssLanguage;
    case 'js': case 'javascript': return javascriptLanguage;
    case 'xml': case 'svg': return xmlLanguage;
    case 'json': return jsonLanguage;
    case 'python': case 'py': return pythonLanguage;
    case 'java': return javaLanguage;
    case 'cpp': case 'c++': case 'c': return cppLanguage;
    case 'php': return phpLanguage;

    // ── Legacy (CodeMirror 5) modes ──────────────────────────────────────
    case 'bash': case 'sh': case 'shell': return StreamLanguage.define(shell);
    case 'yaml': case 'yml': return StreamLanguage.define(yamlMode);
    case 'ini': case 'properties': return StreamLanguage.define(properties);
    case 'tcl': return StreamLanguage.define(tcl);
    case 'vbs': case 'vb': return StreamLanguage.define(vb);

    // ── Aliased to existing languages (no extra bundle cost) ─────────────
    case 'hcl': case 'tf': case 'terraform': return javascriptLanguage;

    // ── Explicit plain-text (no highlighting) ────────────────────────────
    case 'text': case 'plaintext': case 'txt': return null;
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

// ── Search ──────────────────────────────────────────────────────────────────────

/**
 * Open the CodeMirror search panel and pre-fill it with the given query.
 * Case-insensitive, no regex, no whole-word.
 */
export function openSearchPanelWithQuery(view: EditorView, query: string): void {
  openSearchPanel(view);
  view.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: query })),
  });
}

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

    // ── WikiLink autocomplete ─────────────────────────────────────────────
    wikilinkAutocomplete,

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
      // Active-line indicator: use a subtle left-border instead of a
      // full background so the selection layer (z-index: -1) shows through.
      '.cm-activeLine': {
        backgroundColor: 'transparent',
        boxShadow: 'inset 2px 0 0 var(--bg-active)',
      },
      // ── Selection layer (renders BEHIND content at z-index: -1) ─────────
      '.cm-selectionLayer .cm-selectionBackground': {
        background: 'var(--cm-selection)',
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
        background: 'var(--cm-selection-focus)',
      },
      // ── Native ::selection (renders ON the text, above everything) ────────
      // Override CodeMirror's hideNativeSelection which uses system Highlight.
      '.cm-line::selection, .cm-line ::selection': {
        backgroundColor: 'var(--cm-selection-focus)',
        color: 'inherit',
      },
      '.cm-content:focus ::selection, .cm-content:focus::selection': {
        backgroundColor: 'var(--cm-selection-focus)',
        color: 'inherit',
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
      // ── Autocomplete tooltip ────────────────────────────────────────────
      '.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--bg-2)',
        border: '1px solid var(--border-mid)',
        borderRadius: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--fs-sm)',
        maxHeight: '300px',
        overflowY: 'auto',
      },
      '.cm-tooltip-autocomplete ul li': {
        color: 'var(--text-1)',
        padding: '4px 12px',
        lineHeight: '1.5',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'var(--accent-dim)',
        color: 'var(--text-inv)',
      },
      '.cm-completionIcon-text::after': {
        content: '"📄"',
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
