# CodeMirror Editor Integration

## Overview

Replace the Raw `<textarea>` tab with a CodeMirror 6 editor as the primary
editing surface.  The Markdown source-of-truth still lives in a hidden
`<textarea>`; CodeMirror reads from it on show and flushes back on hide
(identical to how the Meta tab operates today).

CodeMirror is lazy-loaded.  If the import fails (offline, chunk not in SW
cache), the app silently falls back to the existing Raw textarea tab.

Frontmatter is **not** edited in CodeMirror — the Meta tab owns all
frontmatter fields.  CodeMirror only shows and edits the Markdown body.

## Packages

```
@codemirror/state
@codemirror/view
@codemirror/commands          # history, newline behaviour, indent
@codemirror/lang-markdown     # markdown + built-in GFM extensions
@codemirror/language          # syntax tree, folding
@codemirror/search            # Ctrl+F
turndown                      # HTML→MD  (lazy-loaded, phase 2)
```

## Module layout

```
src/ts/
  codemirror-edit.ts          # TabPanel impl – owns EditorView lifecycle
  codemirror/
    setup.ts                  # Create EditorView, wire all extensions
    spellcheck.ts             # View-plugin that enables browser spellcheck on DOM
    paste-handler.ts          # Intercept paste for image & HTML (phase 2)
  image-editor.ts             # Resize modal UI (phase 2)
```

## Phase 1 — Core editor (lazy-load, spellcheck, tab integration)

### 1a. Tab model

- Only 3 visible tabs: **View | Code | Meta**
- If CM is available: `#tab-code` is shown, `#tab-raw` stays hidden.
- If CM is **not** available: `#tab-raw` is shown with the existing textarea,
  `#tab-raw` button is labelled "Raw"; `#tab-code` hidden.

### 1b. Availability check + fallback

In `editor-ctrl.ts` `initPanels()`:

```ts
try {
  const mod = await import('./codemirror/setup.js'); // triggers chunk load
  cmEdit.init(mod);                                  // pass EditorView factory
  panels.set('code', cmEdit.tabPanel);
  // hide raw tab button / panel, show code tab button / panel
} catch {
  // CM chunk not in SW cache → use raw textarea
  panels.set('raw', editView.tabPanel);
}
```

The import itself triggers esbuild's code-splitting chunk load.  If the chunk
is in the SW cache the load succeeds even when offline.

### 1c. Frontmatter split

`codemirror-edit.ts`:

- **show(ctx)**: parse `ctx.content` with the existing `parseFrontmatter()`,
  extract `fm.body`, set it in the CM EditorView.
- **hide() / flush()**: read CM state → `body`.  Re-read the hidden textarea
  (which holds the full content including FM) → replace its body portion with
  the new body.  Write back into the textarea.

The hidden textarea remains the canonical source of truth.

### 1d. Spellcheck extension

A small CodeMirror view-plugin in `codemirror/spellcheck.ts`:

- After each view update, walk the editor's content DOM and add
  `spellcheck="true"` to text-bearing elements.
- No external dictionary — relies entirely on the browser's built-in
  spellchecker (works in Chromium + Firefox).
- Zero dependencies.

### 1e. EditorView setup (`codemirror/setup.ts`)

- `basicSetup` excluded — we compose extensions manually to keep the bundle
  lean:
  - line numbers
  - fold gutter
  - history
  - search (Ctrl+F)
  - bracket matching
  - close-brackets
  - rectangular selection
  - multiple selections
  - highlight active line
  - markdown language (`@codemirror/lang-markdown`)
- Export a `createEditor(parent: Element, initialDoc: string): EditorView`
  factory.

### 1f. Keybindings

- Ctrl+S → save (already wired at document level in `ui.ts` — no change
  needed, but ensure CM doesn't swallow it).

### 1g. Dirty tracking

- CM dispatches `note-changed` custom event on every document change so
  `app.ts`'s dirty tracking keeps working.
- Focus/blur events on the CM view should update the dirty-dot / save button
  state appropriately.

## Post Phase 1 Adjustment

- [x] Editable space starts as Extra small, we should use more of the screen.
- [x] Control to change language in spellcheck
  - we can change it in the Frontmatter (via Meta data tab), but
    code mirror doesn't take
  - You can change it via right click on CodeMirror.

