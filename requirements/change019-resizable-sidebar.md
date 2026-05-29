# Resizable Sidebar

## Overview

Add a drag handle between the sidebar and the editor area so the user can
resize the sidebar to any width between 120 px and 500 px.  The chosen
width persists across sessions via localStorage.

Both #sidebar and #header-brand track the same --sidebar-w CSS
custom property, so the header stays aligned with the sidebar at all
times.

## Motivation

The 220 px fixed sidebar is too narrow for deeply nested note trees and
too wide on small laptop screens.  A draggable boundary gives the user
control without adding a preference panel or config key.

Keeping the header brand width synchronised with the sidebar avoids a
broken disjointed look when the sidebar is widened or narrowed.

---

## Design

### CSS approach

A single CSS custom property --sidebar-w (set on #app via JS)
controls the width of both #sidebar and #header-brand.  The resizer
itself is a 5 px div placed between the sidebar and the editor wrap.

    +----------------------------------------------------------+
    | #header                                                  |
    | +-- #header-brand (--sidebar-w) --+- header-center -----+|
    | +---------------------------------+---------------------+|
    |                #main                                     |
    | +- #sidebar -+ |resizer  +- #editor-wrap (flex) --------+|
    | | (--sidebar-w)| 5px     |                             ||
    | +-------------+          +-----------------------------+|
    +----------------------------------------------------------+

### Drag logic (initResizer() in sidebar.ts)

    mousedown on #sidebar-resizer
      -> record startX (clientX) and startW (sidebar width)
      -> add mousemove + mouseup listeners on document
      -> set body cursor to col-resize, user-select: none

    mousemove
      -> delta = currentX - startX
      -> newW = clamp(startW + delta, 120, 500)
      -> #app.style.setProperty(--sidebar-w, newW)

    mouseup
      -> remove listeners, restore cursor
      -> persist width to localStorage(leaf:sidebar-width)

### Persistence

- Key: leaf:sidebar-width
- Stored as a pixel string (e.g. "287")
- Restored in initResizer() before any drag has occurred
- Scoped per-origin (works naturally with multi-host deployments)

### Constraints

| Bound  | Value | Rationale                                     |
|--------|-------|-----------------------------------------------|
| Min    | 120px | Tree view needs ~100 px for icons + filename  |
| Max    | 500px | Prevents accidental fill of the entire editor |

---

## UI changes

| Element            | Before                       | After                                 |
|--------------------|------------------------------|---------------------------------------|
| #sidebar           | width: 220px; min-width: same | width: var(--sidebar-w); min-width: 120px; max-width: 500px |
| #sidebar-resizer   | N/A                          | 5 px grab handle, accent on hover, col-resize cursor |
| #header-brand      | width: var(--sidebar-w)      | Unchanged (tracks sidebar via the same variable) |
| Collapsed state    | Sidebar display: none        | Resizer also hidden                   |
| Mobile (<=600 px)  | Sidebar full-width           | !important overrides prevent JS-set inline style from breaking responsive layout |

---

## Affected modules

| Module               | Change                                               |
|----------------------|------------------------------------------------------|
| spa/css/app.css      | Remove min-width lock, add min/max constraints; add #sidebar-resizer styles; add !important overrides in collapsed + responsive rules |
| spa/index.html       | Add <div id="sidebar-resizer"> between sidebar and editor wrap |
| src/ts/dom-ids.ts    | Add SIDEBAR: sidebar                                |
| src/ts/sidebar.ts    | Add initResizer() function (~55 lines) - drag-to-resize with localStorage persistence |
| src/ts/ui.ts         | Re-export initResizer; call it from bindEvents()     |
| TODO/ui.md           | Mark resizable sidebar as [x] done                   |
