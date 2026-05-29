# In-App Back Button

## Overview

Add a back button to the header bar that lets the user navigate to the
previously viewed note.  A navigation history stack tracks the last 50
visited note IDs; pressing back pops the stack and opens the prior note.

The button sits in `#header-center`, immediately to the left of the
current file name, and is disabled when there is no history to go back to
(i.e. fewer than 2 entries in the stack).

## Motivation

Without a back button, the only way to return to a previously opened note
is to find it again in the sidebar tree.  For deeply nested trees or
large note collections this is slow and breaks flow.  A single-click back
button mirrors familiar browser/tab navigation, keeping the user in
context.

Keeping the button close to the current file name reinforces the mental
model: "I am here; back takes me to where I was before."

---

## Design

### Navigation history stack

A simple LIFO stack (`_navHistory: string[]`) tracks visited note IDs.
It is capped at 50 entries to avoid unbounded memory growth.

```
     ┌──────────────────────────────────────────────────┐
     │                  _navHistory                     │
     │  [ ... older entries ..., most-recent ]         │
     │                         ▲                        │
     │                     _current                     │
     └──────────────────────────────────────────────────┘
```

#### pushHistory(id)

Called whenever a note is opened (via sidebar click, wikilink navigation,
or back-navigation itself).  Skips if `id` equals the top of the stack
to avoid consecutive duplicates.

#### popHistory()

Called on back-button click:

1. Pop the current note (last entry).
2. Pop and return the previous note (new last entry).
3. If the stack has fewer than 2 entries after popping, return `null`.

The returned ID is then loaded and displayed by `handleBack()`.
`handleBack` also calls `pushHistory(prevId)` so the stack stays
consistent — the note the user just navigated *to* becomes the new
current entry.

#### _updateBackButton()

Enables or disables the `#btn-back` element:
- **disabled** when `_navHistory.length ≤ 1` (nothing to go back to)
- **enabled** otherwise

A disabled button is rendered at `opacity: 0.3` via the existing
`.btn-icon:disabled` CSS rule.

### History cleanup

When a note is deleted (either directly or via cross-tab notification),
its ID is removed from the stack so the back button never points to a
non-existent note.

### Edge cases

| Scenario                                   | Behaviour                                    |
|--------------------------------------------|----------------------------------------------|
| No history (first note opened)             | Button disabled                              |
| Open same note twice in a row              | Duplicate push skipped; stack unchanged      |
| Back-navigate to a note that was deleted   | `handleBack` catches the error, shows toast  |
| Note deleted while in history (other tab)  | ID pruned from stack on cross-tab event      |
| History exceeds 50 entries                 | Oldest entry shifted off                     |

---

## UI changes

| Element          | Before                              | After                                          |
|------------------|-------------------------------------|------------------------------------------------|
| `#btn-back`      | N/A                                 | New button in `#header-center`, left of `#current-file` |
| `.btn-icon:disabled` | N/A                             | `opacity: 0.3; cursor: default`                |
| `#header-center` | `#current-file` + `#dirty-dot` only | Now also contains `#btn-back` as first child   |

### Layout sketch

```
┌──────────────────────────────────────────────────────────────────────┐
│ ☰  Leaf │  [←]  my-note.md  ●  │          Save  Sign out           │
└──────────────────────────────────────────────────────────────────────┘
               ▲
          #btn-back
```

The button uses the existing `.btn-icon` class and an SVG left-arrow
icon.  `#header-center` already has `display: flex; gap: 8px`, so the
button sits naturally alongside the file name with no additional layout
CSS required.

---

## Affected modules

| Module               | Change                                                        |
|----------------------|---------------------------------------------------------------|
| `src/ts/dom-ids.ts`  | Add `BTN_BACK: 'btn-back'`                                    |
| `spa/index.html`     | Add `<button id="btn-back">` inside `#header-center`          |
| `spa/css/app.css`    | Add `.btn-icon:disabled` rule                                 |
| `src/ts/app.ts`      | Add `_navHistory` stack, `pushHistory`, `popHistory`, `_updateBackButton`, `handleBack`; wire back-button click; call `pushHistory` from `onOpen`, `navigate-note`, and `handleBack`; prune deleted IDs from history |
| `TODO/ui.md`         | Mark "add an in-app back button" as `[x]` done                |
