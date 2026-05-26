# Context Menu Extraction — Implementation Plan

## Overview

Extract the context-menu logic from `tree.ts` into a shared `context-menu.ts` module
that both the tree view and the upcoming trash view can use.

Currently `tree.ts` has ~50 lines of context-menu logic (`openContextMenu`,
`closeContextMenu`, context-menu outside-click listener). That logic is generic — it
positions a menu near an anchor button and handles outside-click dismissal.
Extracting it avoids duplicating this code in the trash view.

## Architecture

```
context-menu.ts   shared dropdown module
  ├── tree.ts     refactored to call contextMenu.show()
  └── trash-view.ts   (future) will call contextMenu.show()
```

`context-menu.ts` takes an anchor element and an array of `{ label, action, danger? }` items —
the caller decides what goes in the menu. `danger: true` adds a `danger` CSS class
for destructive actions (e.g. Delete). Since tree and trash are never visible
simultaneously, there's no contention over the single `#context-menu` DOM element.

## New file

### `context-menu.ts` (~40 lines)

```
show(anchorEl: HTMLElement, items: { label: string; action: () => void; danger?: boolean }[]): void

  - Positions a shared #context-menu element near anchorEl
  - Populates it with the given items (clears previous content)
  - Each item is rendered as a <button> with class "context-menu-item" (plus
    "danger" when danger is true)
  - Sets up outside-click dismissal (deferred via setTimeout(0) to avoid the
    current click closing the menu immediately)
  - On item click: calls action(), then closes the menu

close(): void

  - Hides the menu, cleans up the outside-click listener
```

Module-level state:
- `outsideListener: ((e: MouseEvent) => void) | null` — stored for cleanup

## Changes to existing files

### `tree.ts` — refactor (~65 lines removed, ~10 added)

Replace `openContextMenu` / `closeContextMenu` / `contextMenuTarget` / outside-listener
with calls to `contextMenu.show(anchorEl, [{ label, action }, ...])`.

Add the import:
```typescript
import * as contextMenu from './context-menu.js';
```

Before (in `handleClick`):
```typescript
const moreBtn = target.closest('.file-item-more');
if (moreBtn) {
  const bar = (moreBtn as HTMLElement).closest('[data-path]') as HTMLElement | null;
  if (bar?.dataset.path) {
    openContextMenu(moreBtn as HTMLElement, bar.dataset.path, handlers);
  }
  return;
}
```

After:
```typescript
const moreBtn = target.closest('.file-item-more');
if (moreBtn) {
  const bar = (moreBtn as HTMLElement).closest('[data-path]') as HTMLElement | null;
  const path = bar?.dataset.path;
  if (path) {
    contextMenu.show(moreBtn as HTMLElement, [
      { label: 'Rename', action: () => handlers.onRename(path) },
      { label: 'Delete', action: () => handlers.onDelete(path), danger: true },
    ]);
  }
  return;
}
```

Remove from `tree.ts`:
- `getContextMenu()` helper function
- `contextMenuTarget` module-level state
- `contextMenuOutsideListener` module-level state
- `openContextMenu()` function
- `closeContextMenu()` function
- `contextMenuTarget` line from the module header JSDoc comment (line 11)

Update `destroy()`:
```typescript
destroy(): void {
  contextMenu.close();
  expandedPaths.clear();
  savedExpanded = null;
  getFileList().innerHTML = '';
},
```

### `spa/index.html` — rename the context menu element

Replace `#item-context-menu` with `#context-menu` (empty, no hardcoded items):

```html
<!-- Before -->
<div id="item-context-menu" class="item-context-menu" role="menu">
  <button class="context-menu-item" data-action="rename">Rename</button>
  <button class="context-menu-item danger" data-action="delete">Delete</button>
</div>

<!-- After -->
<div id="context-menu" class="item-context-menu" role="menu"></div>
```

The element keeps `class="item-context-menu"` so existing CSS positioning
and styling (`.item-context-menu`, `.item-context-menu.open`) still work.
Items are built dynamically by `context-menu.ts` with `class="context-menu-item"`
(and `danger` where applicable).

---

## Implementation order

1. **`context-menu.ts`** — new file with `show()` / `close()`
2. **`index.html`** — replace `#item-context-menu` with `#context-menu`, remove hardcoded items
3. **`tree.ts`** — refactor `handleClick` to use `contextMenu.show()`, remove old code, update `destroy()`

---

## Test cases

All new code requires automated test coverage.

### `context-menu.test.js`

```
describe('context-menu', () => {
  it('show() creates menu items with correct labels')
  it('show() positions menu near the anchor element')
  it('clicking a menu item calls the associated action')
  it('clicking a menu item closes the menu')
  it('clicking outside the menu closes it')
  it('close() cleans up the outside-click listener')
  it('calling show() twice replaces previous items')
})
```

### Manual

- Click ⋯ on a tree note → Rename and Delete appear in the menu
- Click Rename → rename modal opens
- Click Delete → note is deleted
- Click outside the menu → menu closes
- Tree expand/collapse and note opening still work
- No visual regression on menu positioning or styling
