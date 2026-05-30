# System Notes — Design & Implementation Plan

## Overview

Fixed application-provided notes that ship with the app, similar in spirit to
browser `about:` pages.  They are **strictly read-only** documentation.
User-editable settings are deferred to a separate design pass — see
*Future: user-editable settings* below.

---

## Architecture

### Two categories of special notes

|                      | System Notes                    | Special User Notes              |
|----------------------|---------------------------------|---------------------------------|
| **Prefix**           | `@about:*`                      | `_*` (e.g. `_tagcloud`)         |
| **Storage**          | Compiled `.md` → JS bundle      | IndexedDB (Dexie)               |
| **Editable?**        | No — strictly read-only         | Yes — full editor               |
| **Tabs shown**       | VIEW and META only              | VIEW / CODE / RAW / META        |
| **Settings model**   | TBD                             | CODE or META TBD |
| **Examples**         | `@about:help:shortcuts`         | `_tagcloud`                     |

---

## ID Convention

- System notes use `@about:` as a hierarchical namespace.
- Colon (`:`) is the path separator, same as user notes.
- The root node `@about` is both a **branch** (has children) and a **leaf**
  (has its own content — the overview/landing page).
- Plugins register pages under `@about:markdown:plugin-name`.

### Initial tree structure

```
▼ @about                       — branch + leaf: app overview, version, summary
  ├── copyright                — full copyright + all component licenses
  ├── help                     — branch + leaf: help table of contents
  │   ├── shortcuts            — keyboard reference
  │   ├── markdown             — markdown syntax guide
  │   └── codemirror           — CodeMirror usage
  └── markdown                 — branch + leaf: plugin overview
      ├── emoji                — registered by emoji plugin
      └── wikilinks            — registered by wikilinks plugin
```

### Branch nodes without explicit content

If a branch node (e.g. `@about:help`) has registered children but no
`.md` file was registered at that exact ID, its content is **auto-generated**
as an index of links to its children.  This means `@about:help` and
`@about:markdown` don't strictly need their own `.md` files — they'll
show a table of contents automatically.  A hand-written `.md` can still
be registered to provide a richer landing page.

---

## Storage: `.md` files inlined at build time

### Build system

esbuild's built-in `text` loader inlines any imported `.md` file as a string
default export.  One addition to the build command in `package.json`:

```
esbuild src/ts/app.ts --bundle --format=esm --splitting \
  --minify-whitespace --outdir=spa/ --loader:.md=text
```

One type declaration so TypeScript accepts `.md` imports:

```ts
// src/ts/system-notes/md.d.ts
declare module '*.md' {
  const content: string;
  export default content;
}
```

No esbuild plugins.  No pre-build scripts.  The `.md` string is in the bundle,
fully synchronous, always available offline.  The loader flag is project-wide —
any `.md` import anywhere in the dependency graph (including lazy-loaded plugin
chunks) is inlined.

### File layout

```
src/ts/system-notes/
  registry.ts              — register(), get(), list(), isSystemNote()
  builtin.ts               — imports .md files, calls register() for each
  md.d.ts                  — type declaration for *.md imports
  content/
    about.md
    copyright.md
    help.md
    help-shortcuts.md
    help-markdown.md
    help-codemirror.md
```

`builtin.ts` is an explicit, readable mapping — no convention magic:

```ts
import { registerSystemNote } from './registry.js';
import aboutMd            from './content/about.md';
import copyrightMd        from './content/copyright.md';
import helpMd             from './content/help.md';
import helpShortcutsMd    from './content/help-shortcuts.md';
import helpMarkdownMd     from './content/help-markdown.md';
import helpCodemirrorMd   from './content/help-codemirror.md';

registerSystemNote({ id: '@about',                 content: () => aboutMd,         label: 'About' });
registerSystemNote({ id: '@about:copyright',        content: () => copyrightMd,     label: 'Copyright' });
registerSystemNote({ id: '@about:help',             content: () => helpMd,          label: 'Help' });
registerSystemNote({ id: '@about:help:shortcuts',   content: () => helpShortcutsMd, label: 'Shortcuts' });
registerSystemNote({ id: '@about:help:markdown',    content: () => helpMarkdownMd,  label: 'Markdown' });
registerSystemNote({ id: '@about:help:codemirror',  content: () => helpCodemirrorMd, label: 'CodeMirror' });
```

Adding a new page is two lines: one import, one register call.

---

## Registry API (`system-notes/registry.ts`)

```ts
interface SystemNoteDef {
  id: string;              // e.g. "@about:help:shortcuts"
  label: string;           // display name in sidebar
  icon?: string;           // optional ICONS key
  content: () => string;   // synchronous — returns markdown
}

// Core API — all synchronous
export function registerSystemNote(def: SystemNoteDef): void;
export function getSystemNote(id: string): SystemNoteDef | undefined;
export function listSystemNotes(): SystemNoteDef[];
export function isSystemNote(id: string): boolean;
```

### Duplicate registration

If `registerSystemNote()` is called with an ID that is already registered,
it logs a `console.warn` and **skips** (first registration wins).

During build-time we grep the source code for registerSystemNote and
look for duplicates, raising errors when found.

---

## Sidebar integration

### Separate section below user notes

System notes render in their own section at the bottom of the sidebar, visually
separated by a divider.  This section:

- Is rendered by **`tree-view.ts`** — all tree rendering lives in one module.
  `tree-view.ts` exports a new function `renderSystemNotes()` that calls the
  same internal `buildTree()` and `renderTreeNodes()` helpers into a dedicated
  DOM container (`#system-notes-list`).
- **Participates in search/filter** — when the user types in the search box,
  system notes are filtered alongside user notes.  If a system note matches
  the query, it appears (flattened, like regular search results).  If no
  system notes match and no user notes match, the system section is hidden.
- **Hidden in trash mode** — when the sidebar is in trash mode, the system
  notes section is not shown.  It reappears when switching back to notes mode.

```
┌─ sidebar ──────────────────┐
│ 🔍 Filter…          [+ New]│
│                             │
│ 📄 daily-log                │
│ 📁 projects                 │  ← regular TreeView (scrollable)
│   📄 projects:alpha         │
│   📄 projects:beta          │
│                             │
│ ── System ──────────────────│
│ ▼ 📄 @about                 │  ← system TreeView (pinned to bottom)
│   📄 @about:copyright       │
│   📁 @about:help            │
│   📁 @about:markdown        │
└─────────────────────────────┘
```

Click handling: system note items dispatch the same `onOpen` event as user
notes.  `app.ts` routes through `notes.loadNote()` which detects the `@` prefix.

---

## Editor integration

When a system note is opened:


- only VIEW and META panels are rendered.
- Save/Delete/Rename buttons are hidden or disabled.
- Keyboard shortcut for CTRL+E is no-op.

Implementation: a guard in `editor-ctrl.ts` `showEditor()` that checks
`isSystemNote(id)`.

---

## Plugin extensibility

### Registration as module side-effect

Plugins register their documentation via `registerSystemNote()` as a module-level
side effect.  Since `loadPlugins()` in `markdown.ts` uses dynamic `import()`, the
module is evaluated when activated, and the registration runs automatically.

```ts
// src/ts/extensions/emoji.ts
import type MarkdownIt from 'markdown-it';
import { full as emojiPlugin } from 'markdown-it-emoji';
import { registerSystemNote } from '../system-notes/registry.js';
import emojiDocs from './emoji-docs.md';

registerSystemNote({
  id: '@about:markdown:emoji',
  label: 'Emoji',
  content: () => emojiDocs,
});

const plugin: (md: MarkdownIt) => void = (md) => md.use(emojiPlugin);
export default plugin;
```

### File layout for plugin docs

```
src/ts/extensions/
  emoji.ts
  emoji-docs.md          ← lives next to its plugin
  wikilinks.ts
  wikilinks-docs.md
```

The `.md` string lives in the plugin's code-split chunk and is only downloaded
if the plugin is activated by the server's `spa-config`.

---

## Data layer

System notes never touch IndexedDB.  `notes.loadNote()` detects the `@` prefix
and returns a synthetic `NoteData`:

```ts
export async function loadNote(id: string): Promise<NoteData> {
  if (isSystemNote(id)) {
    const def = getSystemNote(id)!;
    const content = def.content();
    const now = Math.floor(Date.now() / 1000);
    const fm = parseFrontmatter(content);
    return {
      id, content,
      created_at: now, updated_at: now,
      current: 'system', created_by: 'leaf', updated_by: 'leaf',
      meta: fm.meta,
    };
  }
  // … existing IndexedDB path
}
```

---

## Navigation & persistence

- System notes participate in the navigation history stack (back button works).
- The last-opened note (persisted to localStorage) can be a system note.
- `navigate-note` custom events work for wikilinks targeting system notes
  (e.g. `[[@about:help:shortcuts]]`).

---

## Future: user-editable settings

Deferred to a separate design pass.  The working model is:

- Settings live in a special IndexedDB note (e.g. `_settings`) with distinguished
  `_` prefix, mirroring the planned `_tagcloud` pattern.
- Structured key=value pairs go in the frontmatter, edited via the META tab.
- Human-readable documentation lives in the markdown body, edited via CODE/RAW.
- The merge strategy between server `spa-config` and user `_settings` is an open
  question (user-overrides, server-overrides, or per-field policy).

For now, `@about:help:settings` (or similar) can document available `spa-config`
options as a reference page.

---

## Implementation phases

| Phase | Scope | Key files |
|-------|-------|-----------|
| **1** | `registry.ts` + `builtin.ts` + `.md` content files + `md.d.ts` | New files |
| **2** | Build flag `--loader:.md=text` | `package.json` |
| **3** | `loadNote()` system-note path + `isSystemNote()` guard | `notes.ts` |
| **4** | `tree-view.ts` — export `renderSystemNotes()` for sidebar section | `tree-view.ts`, `sidebar.ts` |
| **5** | `index.html` — add `#system-notes-list` container + divider element | `index.html` |
| **6** | `editor-ctrl.ts` — VIEW-only mode for system notes | `editor-ctrl.ts` |
| **7** | `app.ts` — disable save/delete/rename for system notes | `app.ts` |
| **8** | Plugin doc registration (emoji, wikilinks) | `extensions/*.ts` |
