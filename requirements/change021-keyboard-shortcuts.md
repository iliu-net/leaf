# Keyboard Shortcuts for Editor Tabs

## Overview

Add three global keyboard shortcuts for fast editor tab switching and save
behaviour.  CTRL+E toggles between view and edit modes, CTRL+M jumps to the
metadata editor, and CTRL+S is refined to save then switch to the view tab
(except on the view tab itself, where it is a no-op).

Switching to the CODE or META tab — whether by shortcut or mouse click —
automatically grabs focus so the user can start typing immediately.

## Motivation

Without keyboard shortcuts, switching between the rendered view, the editor,
and the metadata panel requires mousing to small tab buttons.  For writers
and developers who prefer to keep their hands on the keyboard, this adds
friction on every round-trip from reading to editing and back.

CTRL+E mirrors the edit/view toggle found in Obsidian, Notion, and many
other note-taking tools.  CTRL+M provides dedicated access to metadata
without having to cycle through tabs.

## Design

### Shortcut matrix

| Shortcut | From tab | Action |
|----------|----------|--------|
| CTRL+S | VIEW | no-op |
| CTRL+S | CODE / RAW / META | save → switch to VIEW |
| CTRL+E | VIEW | → CODE (if CodeMirror loaded) or RAW + focus |
| CTRL+E | META | → CODE (if CodeMirror loaded) or RAW + focus |
| CTRL+E | CODE | pass-through (let CodeMirror / browser handle) |
| CTRL+E | RAW | → VIEW |
| CTRL+M | any except META | → META + focus title field |
| CTRL+M | META | re-focus title field (no tab change) |

All shortcuts are no-ops when no note is open.

### CTRL+E rationale

CTRL+E means "go to edit mode."  On the rendered VIEW tab it opens the
editor (CODE or RAW fallback).  On the META tab it also opens the editor.
On the RAW tab it returns to VIEW.  On the CODE tab the shortcut is
deliberately not intercepted — CodeMirror's native keymap (e.g. `Ctrl+E`
for end-of-line in some keybindings, or any future extension binding) takes
precedence, and if unhandled the browser sees it.

In a regular browser tab, Chrome captures CTRL+E for the address bar.
This app targets PWA usage, where CTRL+E is free.

### CTRL+S rationale

The previous CTRL+S behaviour saved unconditionally.  The refined version:

- **CODE / RAW / META → save then VIEW.**  Manual save is an explicit
  "I'm done editing" signal, so switching to the rendered view gives
  immediate feedback.  Auto-save (debounced, configurable) handles
  continuous editing without a tab switch.

- **VIEW → no-op.**  There is nothing to save when viewing a rendered
  note; the old behaviour of firing `onSave()` was redundant.

### Focus-on-entry

The `TabPanel` interface gained an optional `focus()` method.  After every
`show()` call inside `switchTab()`, `panel.focus?.()` is invoked so the
relevant input field receives keyboard focus:

| Panel | Focus target |
|-------|-------------|
| CODE | CodeMirror editor viewport |
| META | `#meta-title` input (frontmatter title) |
| RAW | `#note-area` textarea |
| VIEW | none (read-only rendered view) |

This fires regardless of how the tab was activated — mouse click on a tab
button, keyboard shortcut, or programmatic `switchEditorTab()` call.

### CTRL+M on the META tab

When already on the META tab, CTRL+M does not re-render the panel.
Instead it calls `focusActiveTab()`, which re-focuses the title input.
This is useful after the user clicks away into another field and wants to
jump back to the title without mousing.

---

## Implementation

### New exports from `editor-ctrl.ts`

| Export | Purpose |
|--------|---------|
| `getActiveTab(): string` | Read current tab for shortcut routing |
| `isCmAvailable(): boolean` | Decide CODE vs RAW as CTRL+E destination |
| `switchEditorTab(tab): Promise<void>` | Programmatic tab switch (public wrapper around private `switchTab`) |
| `focusActiveTab(): void` | Re-focus the current panel's primary input |

The private `switchTab()` function now calls `panel.focus?.()` after
`panel.show(ctx)` on every tab entry.

### TabPanel interface extension (`tab-panel.ts`)

```ts
export interface TabPanel {
  init(): void;
  show(ctx: TabPanelContext): void | Promise<void>;
  hide(): void;
  focus?(): void;   // ← new, optional
}
```

Existing panels implement `focus` as follows:

- **`codemirror-view.ts`** — `cmFocus()` → `_cmView?.focus()`
- **`meta-view.ts`** — `metaFocus()` → `_metaTitle?.focus()`
- **`edit-view.ts`** — existing `focus()` function (now wired into `tabPanel`)
- **`markdown-view.ts`** — omits `focus` (no primary input to focus)

### Keyboard handler (`ui.ts`)

A single `keydown` listener on `document` dispatches all three shortcuts.
It checks `e.ctrlKey || e.metaKey` (Mac compatibility), calls
`editor.getActiveTab()` and `editor.getCurrentNoteId()` for routing, and
dispatches `editor.switchEditorTab()` or `editor.focusActiveTab()`.

The old CTRL+S handler (`preventDefault` + `onSave()` only) is replaced.

---

## Affected modules

| Module | Change |
|--------|--------|
| `src/ts/tab-panel.ts` | Add optional `focus?()` to `TabPanel` interface |
| `src/ts/codemirror-view.ts` | Add `cmFocus()`, wire into `tabPanel` |
| `src/ts/meta-view.ts` | Add `metaFocus()`, wire into `tabPanel` |
| `src/ts/edit-view.ts` | Wire existing `focus()` into `tabPanel` |
| `src/ts/editor-ctrl.ts` | Export `getActiveTab`, `isCmAvailable`, `switchEditorTab`, `focusActiveTab`; call `panel.focus?.()` in `switchTab` |
| `src/ts/ui.ts` | Replace CTRL+S handler; add CTRL+E and CTRL+M handlers |
| `tests/spa/ui.test.js` | 8 new shortcut tests; update 2 existing CTRL+S tests for new VIEW/no-op behaviour |

---

## Edge cases

| Scenario | Behaviour |
|----------|-----------|
| No note open | All shortcuts no-op (`getCurrentNoteId()` returns null) |
| CodeMirror not loaded | `isCmAvailable()` returns false; CTRL+E uses RAW as edit target |
| CTRL+S on VIEW | Handler returns early without calling `onSave()` |
| CTRL+E on CODE | Handler returns without `preventDefault()`; event bubbles to browser/CM |
| CTRL+M on META | `focusActiveTab()` re-focuses title; no tab switch overhead |
| Tab button mouse-click → CODE | `switchTab` → `focus?.()` fires; CM grabs focus |
| Tab button mouse-click → META | `switchTab` → `focus?.()` fires; title input grabs focus |
| Non-PWA browser (CTRL+E) | Browser may capture CTRL+E (omnibox); app targets PWA |
