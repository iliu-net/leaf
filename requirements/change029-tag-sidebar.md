# Change 029 — Tag sidebar mode

## Summary

A third sidebar mode ("Tags") groups notes by their merged tags (user-tags
plus auto-tags) and renders an expandable tag tree. Untagged notes appear at
the bottom under an "Untagged" group. The mode sits alongside the existing
Folder and Trash modes in the app menu.

---

## Motivation

The folder tree is structural — notes are organised by id prefix (e.g.
`projects:alpha`, `meetings:2026-05-30`). But tags cross-cut that
hierarchy. A user who tagged notes with `work`, `urgent`, or `finance`
should be able to browse by those tags to see all related notes regardless
of their id prefix.

Offering a dedicated Tag sidebar mode makes this a first-class navigation
experience rather than a secondary filter on the search bar.

---

## Mode switching

| From | To | Menu path |
|---|---|---|
| Folder | Tags | Menu → Tags (direct) |
| Tags | Folder | Menu → Folder (direct) |
| Trash | Tags | Menu → Tags (two-step: trash→notes→tags, transparent) |
| Tags | Trash | Menu → Tags (two-step: tags→notes→trash, transparent) |

Each mode has its own chrome (toolbar, footer, etc.) and its own
`SidebarView` implementation:

| Mode | View | Sidebar toolbar | Sidebar footer | System section |
|---|---|---|---|---|
| Folder | `TreeView` | visible (search + New) | visible (note count) | visible |
| Tags | `TagView` | visible (search + New) | visible (note count) | hidden |
| Trash | `TrashView` | hidden | trash-specific | hidden |

The search input is shared across Folder and Tags modes and is cleared on
every mode switch.

---

## Tag view behaviour

### Data model

`TagView` receives `TagViewItem[]` — `NoteMeta` enriched with a `tags:
string[]` field. Tags are the merged set from `mergeTags(user-tags,
auto-tags)` (see change028).

The enriched items are built by `refreshTagList()` in `notes-ctrl.ts`,
which loads each note's content from IndexedDB, parses frontmatter, and
calls `mergeTags()`.

### Rendering

```
▼ finance (3)
  ├── expense-report-q1
  ├── invoice-acme-042
  └── budget-2026              project, work
▶ meetings (1)
▶ work (2)
▼ Untagged (1)
  ├── scratchpad
```

- Tag groups are sorted natural-alphabetically.
- The first group auto-expands on initial render.
- Each note row shows the note id and (in a muted secondary text) any
  **other** tags the note belongs to that aren't the current group's tag.
- Search filters both tag names and note ids within the loaded data
  (client-side — no DB re-query).

### Click handling

| Click target | Action |
|---|---|
| Toggle arrow (▶/▼) | Expand / collapse the tag group |
| Tag header bar | Same as toggle arrow |
| Note item | Opens the note (same `onOpen` handler as Folder mode) |

---

## Files created

| File | Purpose |
|---|---|
| `src/ts/tag-view.ts` | `TagView` implementing `SidebarView<TagViewItem>` — group builder, filter, render, click handling |

## Files modified

| File | Change |
|---|---|
| `src/ts/dom-ids.ts` | Added `MENU_TAGS: 'menu-tags'` constant |
| `src/ts/sidebar.ts` | Extended `SidebarMode` with `'tags'`; added `onToggleTags` to `UIEventHandlers`; `setMode('tags')` shows toolbar, hides system section, sets `TagView`; three-way menu checks; `MENU_TAGS` click handler with two-step transitions; `renderTagList()` export; search cleared on mode switch |
| `src/ts/ui.ts` | Re-exports `getView`, `renderTagList` from sidebar |
| `src/ts/notes-ctrl.ts` | Added `refreshTagList()` (load all notes → extract merged tags → render); `handleToggleTags()` (toggle notes↔tags); `handleSearch()` dispatches to `TagView.setFilter` in tags mode |
| `src/ts/app.ts` | Wired `onToggleTags → notesCtrl.handleToggleTags()` |
| `spa/index.html` | Added `<button id="menu-tags">` between Folder and Trash in the app menu dropdown |
| `spa/css/layout.css` | Added `.tag-count` badge style and `.file-item-tags` inline tag style |

---

## Architecture

```
User clicks "Tags" in menu
  │
  ├─ sidebar.init() → menuTags click handler
  │    └─ handlers.onToggleTags()
  │
  ├─ notesCtrl.handleToggleTags()
  │    │
  │    ├─ sidebar.setMode('tags')
  │    │    ├─ _mode = 'tags'
  │    │    ├─ _updateMenuChecks()         ← ✓ moves to Tags
  │    │    ├─ clear search input
  │    │    ├─ show toolbar, footer
  │    │    ├─ hide trash chrome, system section
  │    │    └─ _currentView = TagView
  │    │
  │    └─ refreshTagList()
  │         │
  │         ├─ notes.listNotes()           ← NoteMeta[] from IndexedDB
  │         ├─ for each: dbGetNote(id)     ← load content
  │         │    ├─ parseFrontmatter()
  │         │    └─ mergeTags(userTags, autoTags)
  │         │
  │         └─ renderTagList(items, currentId)
  │              ├─ _currentView = TagView
  │              └─ TagView.render(items, currentId)
  │                   ├─ buildGroups()     ← tag → notes map
  │                   └─ _renderAll()      ← DOM tree
  │
  └─ User clicks a note
       └─ sidebar FILE_LIST listener
            └─ _currentView.handleClick(e, handlers)
                 └─ TagView.handleClick()
                      ├─ .tree-toggle?     → toggle expand
                      ├─ .tree-bar[data-tag]? → toggle expand
                      └─ .file-item?       → handlers.onOpen(id)
```

---

## Future work

- **Tag icon** — use a dedicated tag icon (currently reuses the document
  icon)
- **Tag reordering** — allow drag-and-drop reordering of tags within the
  view
- **Tag stats** — show total notes per tag in the count badge (already
  done) and total tags in the footer
- **Performance** — batch-load note content in `refreshTagList()` or
  cache tag data indexed by `updated_at` to avoid loading every note's
  content on each tag-view render
- **Virtual scrolling** — for workspaces with hundreds of tags
