# WikiLinks

## Motivation

Internal note links are essential for a personal wiki.  The `[[page]]` syntax is
the de-facto standard across Obsidian, MediaWiki, and other note-taking tools.
Rather than pulling in an external npm package for a trivial regex, a custom
inline rule hooks directly into markdown-it's inline parser — zero dependencies,
full control over link resolution and URL generation.

External links (`http://`, `https://`) need `target="_blank"` so they don't
destroy the running SPA when clicked.

## New files

| File | Purpose |
|---|---|
| `src/ts/extensions/wikilinks.ts` | Custom markdown-it inline rule: `[[page]]`, `[[page\|label]]`, `[[page\|]]` |

## Modified files

| File | Change |
|---|---|
| `src/ts/markdown.ts` | Added `wikilinks` to plugin registry. External link renderer: adds `target="_blank"`, `rel="noopener noreferrer"`, `class="external-link"`. |
| `src/ts/markdown-view.ts` | Import `dbGetNote`. Delegated click handler on `a[data-note]` dispatches `navigate-note` custom event. `_postProcessWikilinks()`: batch-loads referenced notes, resolves `[[page\|]]` titles from frontmatter, adds `wikilink-missing` class for non-existent targets. |
| `src/ts/app.ts` | Import `dbGetNote`. Listens for `navigate-note` on `document`: if note exists → opens it (same dirty-check + openNote flow as sidebar); if note doesn't exist → opens create modal with name pre-filled (`openModal(null, id)` — no prefix). |
| `spa/css/app.css` | Styles for `.wikilink`, `.wikilink-missing` (red, dashed underline), `.external-link::after` (↗ icon). |
| `demo/cookbook/api/config.php` | Added `'wikilinks'` to `markdown.plugins` |
| `demo/cookbook/api/config.php-sample` | Added `'wikilinks'` to example comments |

## Syntax

| Input | Rendered HTML | Behavior on click |
|---|---|---|
| `[[page]]` | `<a href="?note=page" class="wikilink" data-note="page">page</a>` | Opens note `page` |
| `[[page\|Label]]` | `<a href="?note=page" class="wikilink" data-note="page">Label</a>` | Opens note `page` |
| `[[page\|]]` | `<a href="?note=page" class="wikilink" data-note="page" data-resolve-title="true">page</a>` | Opens note `page`; link text replaced with target's `title` frontmatter field post-render |
| `[text](https://...)` | `<a href="https://..." target="_blank" rel="noopener noreferrer" class="external-link">text ↗</a>` | Opens in new tab |

## Navigation flow

```
User clicks [[page]] in View tab
  ↓
markdown-view.ts: click → a[data-note] → e.preventDefault()
  ↓
dispatch CustomEvent('navigate-note', { detail: { id: 'page' } })
  ↓
app.ts: navigate-note listener
  ├─ _dirty? → confirm discard
  ├─ dbGetNote(id) → null? → openModal(null, id)   [note doesn't exist, create it]
  └─ dbGetNote(id) → exists → notesCtrl.openNote(id) → show editor
```

## Post-render wikilink processing

After markdown-it renders HTML and before syntax highlighting hydration,
`_postProcessWikilinks()` runs a single batch over all `a[data-note]` elements:

1. Gather unique note IDs from all wikilinks
2. Batch-load all referenced notes from IndexedDB in parallel (`dbGetNote`)
3. Parse frontmatter to extract `title` fields
4. For each link:
   - If `data-resolve-title` is set (`[[page|]]`): replace text with title (or keep page ID if no title)
   - If note doesn't exist: add `class="wikilink-missing"`

## CSS

```css
.markdown-body a.wikilink        → accent color (default)
.markdown-body a.wikilink-missing → --danger red, dashed underline
.markdown-body a.external-link   → trailing ↗ icon (::after pseudo-element)
```

## External link hardening

The base `link_open` renderer in `markdown.ts` intercepts every `<a>` with an
`http://` or `https://` href and adds:
- `target="_blank"` — opens in a new tab
- `rel="noopener noreferrer"` — security
- `class="external-link"` — visual indicator

markdown-it v14 has no default `link_open` rule (it falls through to the generic
`renderToken()`), so a custom wrapper checks for an existing rule and falls back
to `self.renderToken()` if absent.
