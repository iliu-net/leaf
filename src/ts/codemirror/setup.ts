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
import { EditorState } from '@codemirror/state';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands';
import {
  foldGutter, foldKeymap, bracketMatching, indentOnInput,
  syntaxHighlighting, HighlightStyle,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { htmlLanguage } from '@codemirror/lang-html';
import { cssLanguage } from '@codemirror/lang-css';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { xmlLanguage } from '@codemirror/lang-xml';

import { spellcheckPlugin } from './spellcheck.js';

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

// ── High-contrast syntax highlighting ──────────────────────────────────────────

/**
 * Custom HighlightStyle with bright, distinct colours optimised for
 * readability on a near-black (#0a0a0a) background.
 *
 * Colours are pushed harder than CodeMirror's defaultHighlightStyle —
 * no muted tones, everything earns its place on screen.
 */
const highContrast = HighlightStyle.define([
  // ── Markdown structure ────────────────────────────────────────────────
  { tag: tags.heading1, color: '#ffa657', fontWeight: 'bold', fontSize: '1.5em' },
  { tag: tags.heading2, color: '#ffa657', fontWeight: 'bold', fontSize: '1.3em' },
  { tag: tags.heading3, color: '#ffa657', fontWeight: 'bold', fontSize: '1.15em' },
  { tag: tags.heading4, color: '#ffa657', fontWeight: 'bold' },
  { tag: tags.heading5, color: '#ffa657', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#ffa657', fontWeight: 'bold' },
  { tag: tags.strong,      color: '#ff7b72', fontWeight: 'bold' },
  { tag: tags.emphasis,    color: '#d2a8ff', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: '#8b949e', textDecoration: 'line-through' },
  { tag: tags.link,        color: '#58a6ff', textDecoration: 'underline' },
  { tag: tags.url,         color: '#7ee787', textDecoration: 'underline' },
  { tag: tags.monospace,   color: '#e6edf3', backgroundColor: '#ffffff15', borderRadius: '3px' },
  { tag: tags.quote,       color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.list,        color: '#d4c4a0', fontWeight: 'bold' },
  { tag: tags.contentSeparator, color: '#b0a38b' },

  // ── Meta / hidden ─────────────────────────────────────────────────────
  { tag: tags.meta,                 color: '#6e7681' },
  { tag: tags.processingInstruction, color: '#6e7681', fontStyle: 'italic' },

  // ── Nested code blocks: keywords & literals ───────────────────────────
  { tag: tags.keyword,  color: '#79c0ff' },
  { tag: tags.atom,     color: '#79c0ff' },
  { tag: tags.bool,     color: '#79c0ff' },
  { tag: tags.self,     color: '#79c0ff' },
  { tag: tags.null,     color: '#79c0ff' },
  { tag: tags.string,   color: '#7ee787' },
  { tag: tags.character, color: '#7ee787' },
  { tag: tags.escape,   color: '#d2a8ff' },
  { tag: tags.number,   color: '#a5d6ff' },
  { tag: tags.regexp,   color: '#7ee787' },
  { tag: tags.color,    color: '#a5d6ff' },

  // ── Nested code blocks: names ─────────────────────────────────────────
  { tag: tags.typeName,       color: '#ffa657' },
  { tag: tags.className,      color: '#ffa657' },
  { tag: tags.tagName,        color: '#79c0ff' },
  { tag: tags.variableName,   color: '#e6edf3' },
  { tag: tags.propertyName,   color: '#79c0ff' },
  { tag: tags.attributeName,  color: '#d2a8ff' },
  { tag: tags.labelName,      color: '#79c0ff' },
  { tag: tags.namespace,      color: '#d2a8ff' },
  { tag: tags.macroName,      color: '#d2a8ff' },

  // ── Nested code blocks: operators & punctuation ───────────────────────
  { tag: tags.operator,   color: '#c9d1d9' },
  { tag: tags.punctuation,color: '#c9d1d9' },
  { tag: tags.separator,  color: '#c9d1d9' },
  { tag: tags.bracket,    color: '#c9d1d9' },

  // ── Nested code blocks: comments ──────────────────────────────────────
  { tag: tags.comment,     color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.blockComment,color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.docComment,  color: '#8b949e', fontStyle: 'italic' },

  // ── Diff / change markers ─────────────────────────────────────────────
  { tag: tags.inserted, color: '#7ee787' },
  { tag: tags.deleted,  color: '#ff7b72' },
  { tag: tags.changed,  color: '#d2a8ff' },
  { tag: tags.invalid,  color: '#ff7b72', textDecoration: 'underline wavy' },
]);

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

    // ── Syntax highlighting ──────────────────────────────────────────────
    syntaxHighlighting(highContrast),

    // ── Markdown language (with nested code-fence highlighting) ──────────
    markdown({ codeLanguages }),

    // ── Spellcheck ───────────────────────────────────────────────────────
    spellcheckPlugin(),

    // ── Change notification ──────────────────────────────────────────────
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange();
    }),

    // ── Theme — matches app.css tokens ───────────────────────────────────
    EditorView.theme({
      '&': {
        fontSize: '13.5px',
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
        backgroundColor: 'rgba(212, 196, 160, 0.12)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'rgba(212, 196, 160, 0.18)',
        outline: '1px solid rgba(212, 196, 160, 0.35)',
      },
    }),
  ];

  const view = new EditorView({
    state: EditorState.create({ doc: initialDoc, extensions }),
    parent,
  });

  return view;
}
