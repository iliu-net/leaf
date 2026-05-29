# Change 023 — Theming

## Summary

Refactored the single `app.css` into a theming system supporting 4 themes:
**Dark**, **Light**, **Magenta**, and **Paired-12**. All fonts scaled +30%.
Persisted per-origin in localStorage, default via `prefers-color-scheme`.
Theme switcher in the logo dropdown menu (top-left).

Simultaneously made highlight.js and CodeMirror syntax highlighting
theme-aware so all 4 themes have readable code blocks.

## Files created

- `spa/css/layout.css` — structural CSS only (display, flex, position,
  overflow, padding, margin, z-index, animations). No colors or fonts.
- `spa/css/theme-dark.css` — dark editorial theme. DM Sans + DM Mono.
  Warm gold accent (#e0d4b0).
- `spa/css/theme-light.css` — paper-like light theme. Inter + JetBrains
  Mono. Dark gold accent (#8b6914).
- `spa/css/theme-magenta.css` — Deutsche Telekom Magenta style. Outfit
  + Fira Code. #e20074 accent on white background.
- `spa/css/theme-paired-12.css` — cool bluish theme anchored on
  ColorBrewer Paired-12 blues. IBM Plex Sans + IBM Plex Mono.
  #1f78b4 accent.

## Files modified

### `spa/index.html`
- Replaced `<link rel="stylesheet" href="css/app.css">` with links to
  `layout.css` + 4 `theme-*.css` files.
- Added inline `<script>` in `<head>` (before CSS links) that sets
  `<html data-theme>` from localStorage or `prefers-color-scheme`,
  preventing flash of unstyled content.
- Added Theme submenu to the `#app-menu` dropdown with 4 radio items
  (Dark, Light, Magenta, Paired-12), each with `data-theme-val`.

### `src/ts/ui.ts`
- Added `applyTheme(theme)` function: sets `data-theme` attribute,
  persists to `localStorage` (`leaf:theme` key), updates
  `theme-color` meta tag, syncs active indicator in submenu, and
  notifies CodeMirror via `window.__leafSetCMTheme`.
- Added click handlers on `.theme-option` buttons in `bindEvents()`.
- Syncs initial active indicator on boot.

### `spa/css/hljs.css`
- Split into two `[data-theme]`-gated blocks:
  - Dark + Paired-12 → GitHub Dark theme
  - Light + Magenta → GitHub Light theme
- Background uses `var(--bg-3)` instead of hardcoded color.

### `src/ts/codemirror/setup.ts`
- Renamed `highContrast` → `highlightDark`.
- Added `highlightLight` (HighlightStyle) with colors optimised for
  light backgrounds (blue headings, red keywords, green strings).
- Added `Compartment` for syntax highlighting so it can be swapped
  at runtime without recreating the editor.
- `createEditor()` reads `data-theme` at init time to pick the
  correct initial highlight style.
- Exported `window.__leafSetCMTheme(theme)` for zero-import
  cross-module communication (ui.ts calls it; no-op if CM chunk
  hasn't lazy-loaded yet).
- Changed hardcoded accent colors in `EditorView.theme()` to CSS
  variables (`var(--accent-glow)`, `var(--accent-dim)`).
- Changed hardcoded `fontSize: '13.5px'` → `'var(--fs-mono)'`.

### `spa/css/cm.css`
- Added `#tab-code .cm-editor { font-size: var(--fs-mono); }`.

### `spa/sw.js`
- Updated SHELL cache list: `app.css` → `layout.css` + 4 theme files.
- Bumped cache version `leaf-v4` → `leaf-v5`.

## Files deleted

- `spa/css/app.css` — replaced by the 5 new CSS files above.

## Architecture

```
spa/css/
  layout.css          ← structure only, always active
  theme-dark.css      ← [data-theme="dark"] { ... }
  theme-light.css     ← [data-theme="light"] { ... }
  theme-magenta.css   ← [data-theme="magenta"] { ... }
  theme-paired-12.css ← [data-theme="paired-12"] { ... }
  hljs.css            ← [data-theme] blocks for dark + light syntax
  cm.css              ← CodeMirror layout (uses CSS variables)
```

Theme switching flow:
1. User clicks Theme submenu item → `data-theme-val` read
2. `applyTheme()` sets `<html data-theme>`, localStorage, meta tag
3. CSS selectors instantly activate the new theme's colors + fonts
4. `window.__leafSetCMTheme(theme)` reconfigures CM syntax compartment

Initial load:
1. Inline `<head>` script runs before any CSS — no FOUC
2. Reads `localStorage['leaf:theme']` or falls back to
   `prefers-color-scheme`
3. Sets `<html data-theme>` and `theme-color` meta

## Theme summary

| Theme     | Background | Accent  | UI Font      | Mono Font      |
|-----------|-----------|---------|-------------|----------------|
| Dark      | #080808   | #e0d4b0 | DM Sans     | DM Mono        |
| Light     | #fafaf8   | #8b6914 | Inter       | JetBrains Mono |
| Magenta   | #ffffff   | #e20074 | Outfit      | Fira Code      |
| Paired-12 | #0d1117   | #1f78b4 | IBM Plex Sans | IBM Plex Mono |

All themes use high-contrast text ratios (≥15:1 for body text,
≥4.5:1 for secondary text). Font sizes are +30% larger than the
original single-theme values.
