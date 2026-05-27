# View Panel

## New files

| File | Purpose |
|---|---|
| `src/ts/markdown.ts` | Wraps markdown-it: registers extra inline markup, exposes `registerInlinePlugin()`, `registerFenceRenderer()`, `registerBlockPlugin()` |
| `src/ts/render-fm.ts` | Shared: `renderFrontmatter(fm, noteData)` → HTML string (title as `<h1>`, merged tags, key\|value table). Also exports `renderStats(body)`, `renderSystemInfo(noteData)`, `esc()`, `fmtVal()` |
| `src/ts/view-panel.ts` | View tab: `initViewPanel()`, `showViewPanel(content, noteData)`, `hideViewPanel()`. Assembles: sticky header + `renderFrontmatter()` + `markdown.parse(body)` + footer. **Lazy-loaded** via dynamic `import()` |
| `src/ts/extensions/_README` | Placeholder: "Drop markdown-it plugins or fence renderers here" |

## Modified files

| File | Change |
|---|---|
| `spa/index.html` | Add View tab button (`#tab-btn-view`) and `#tab-view` panel with `.view-content` + `.view-footer` containers. Tab order: **[View] [Raw] [Meta]** |
| `spa/css/app.css` | Styles for `.markdown-body` (headings, lists, tables, code blocks, links — all dark-mode compatible). Styles for `.view-footer` (small font). Ensure `.tab-btn.active` / `.tab-panel.active` rules work generically for three tabs. |
| `src/ts/editor.ts` | `_activeTab` → `'view' \| 'meta' \| 'raw'`, default → `'view'`. `showEditor()` caches `noteData` for View panel footer. `switchTab()` handles all transitions (see below). Wire view tab button. Lazy-load View on first switch to it. |
| `src/ts/ui.ts` | `showTrashBanner()` → replace inline HTML-building with shared helpers from `render-fm.ts` and `markdown.ts`. Move `esc()` / `fmtVal()` out. |
| `src/package.json` | Add `markdown-it` dependency |

## Tab transition logic

View is read-only, so leaving it has nothing to flush. Raw is the source of truth (textarea). Meta is the only tab that can hold unflushed state.

| Action | Behavior |
|---|---|
| Leaving **Meta** | Flush pending meta to textarea (same as today) |
| Leaving **Raw** or **View** | Nothing |
| Entering **Raw** | Show textarea panel, focus it |
| Entering **Meta** | Re-parse frontmatter from textarea, render meta form |
| Entering **View** | Re-parse from textarea, render view panel (lazy-load markdown on first entry) |

Source files touched: `src/ts/editor.ts` (switchTab + showEditor + initPanels), `src/ts/view-panel.ts` (new), `spa/index.html` (new DOM elements). Other tab modules (`raw-panel.ts`, `meta-panel.ts`) are unchanged.

## Data flow for render-fm.ts

Three independent exports, each receiving only the data it needs:

```
renderFrontmatter(fm: FrontmatterResult, noteData: NoteData)  →  HTML string
  │
  ├── meta.title  →  <h1 class="view-title">{title || noteId}</h1>
  │
  ├── Tags row:
  │     merge user-tags + auto-tags (auto-tags is a future feature, not yet in parser)
  │       →  dedup  →  sort
  │       →  <tr><td class="fm-key">Tags</td><td class="fm-val">a, b, c</td></tr>
  │
  └── Remaining fields (summary, custom, etc.):
        →  <tr><td class="fm-key">{key}</td><td class="fm-val">{value}</td></tr>
        wrapped in <table class="fm-table">

renderStats(body: string)  →  HTML string (word/char/line counts)

renderSystemInfo(noteData: NoteData)  →  HTML string (version, timestamps, authors table)
```

Also exports `esc(s: string)` and `fmtVal(v: string | string[] | undefined)` — HTML escaping and value formatting — moved here from `ui.ts` so both View panel and Trash banner can use them.

## View panel layout

```
+----------------------------------+
|  <h1> Sticky Title </h1>         |  ← position: sticky (inside #tab-view)
+----------------------------------+
|  | key    | value          |     |
|  | Tags   | a, b, c        |     |  ← frontmatter table
|  | ...    | ...            |     |
+----------------------------------+
|                                  |
|  Rendered markdown body          |  ← scrollable (.view-content with overflow-y: auto)
|                                  |
+----------------------------------+
|  342 words · 2,048 chars        |  ← .view-footer (small font)
|  Version abc · Created ...      |
+----------------------------------+
```

## markdown.ts extension hooks

- `registerInlinePlugin(name, plugin)` — markdown-it plugin for inline rules
- `registerFenceRenderer(languages, fn)` — overrides `md.renderer.rules.fence`
- `registerBlockPlugin(name, plugin)` — markdown-it plugin for block rules

Fence renderer lazy-loading: hook API is available but no implementations are included in this plan. Deferred to future work.

## Reuse in Trash UI

`showTrashBanner()` replaces its inline HTML-building with the shared helpers:
`renderFrontmatter()` + `markdown.parse(body)` + `renderStats()` + `renderSystemInfo()`

**CSS scoping note**: The trash banner uses its own CSS classes (`.trash-meta-row`, `.trash-fm-table`, `.trash-banner-content`). The shared helpers output generic classes like `.fm-table` and `.view-title`. The trash banner wrapper should either:
- Scope with a parent selector (e.g. `#trash-banner .fm-table { … }`), or
- Accept a CSS prefix parameter

## Lazy loading

The View tab module (`view-panel.ts`) and its markdown-it dependency are loaded on first use via dynamic `import()`:

```
switchTab('view') → if (!viewPanel) { viewPanel = await import('./view-panel.js') } → viewPanel.showViewPanel(content, noteData)
```

Same pattern already used by History (`history-view.ts`). This keeps markdown-it out of the initial bundle.
