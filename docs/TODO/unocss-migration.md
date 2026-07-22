# Migration Plan: Traditional CSS → UnoCSS

## 1. Current Architecture Summary

### 1.1 CSS File Breakdown (~4,800 lines total)

| File | Lines | Purpose |
|------|-------|---------|
| `layout.css` | 1,011 | Positioning, display, flex, grid, overflow, padding, margin, width/height, z-index, animations, scrollbar, markdown body, responsive breakpoints, all component layouts |
| `theme-dark.css` | 869 | Dark theme: fonts (DM Sans + DM Mono), CSS tokens (`--bg`, `--text-1`, etc.), colors for every component |
| `theme-light.css` | 870 | Light theme: fonts (Inter + JetBrains Mono), same token structure |
| `theme-magenta.css` | 872 | Magenta theme: fonts (Outfit + Fira Code), same token structure |
| `theme-paired-12.css` | 874 | Paired-12 theme: fonts (IBM Plex Sans + IBM Plex Mono), same token structure |
| `hljs.css` | 238 | highlight.js syntax themes (GitHub Dark / GitHub Light) |
| `cm.css` | 33 | CodeMirror layout + scrollbar styles |
| `spreadsheet.css` | 62 | Spreadsheet table styles (render-time component) |
| `katex.css` | 1 | KaTeX re-export (math rendering) |

### 1.2 Entry Point

```ts
// src/ts/styles.ts — imported by main.tsx
import '../css/layout.css';
import '../css/theme-dark.css';
import '../css/theme-light.css';
import '../css/theme-magenta.css';
import '../css/theme-paired-12.css';
import '../css/hljs.css';
import '../css/cm.css';
import '../css/katex.css';
import '../css/spreadsheet.css';
```

### 1.3 Architecture Patterns

**Theme system:** CSS custom properties scoped to `[data-theme="dark"]`, `[data-theme="light"]`, etc. Each theme file redefines the same set of tokens (`--bg`, `--bg-2`, `--bg-3`, `--text-1`, `--text-2`, `--text-3`, `--accent`, `--border`, etc.). Every component rule uses `var(--x)` for all color/font/size values.

**Layout:** Traditional CSS with a separation of concerns — `layout.css` handles all structural CSS (display, position, flex, grid, padding, margin, width, height, z-index). Theme files handle only colors, fonts, typography, transitions, and box-shadows.

**Responsive:** One `@media (max-width: 768px)` breakpoint at the bottom of `layout.css` overriding desktop styles.

**Inline styles:** Components occasionally use `style={{ ... }}` prop for dynamic display values (`{ display: condition ? 'none' : 'flex' }`).

**CodeMirror theme:** Mixed approach — `cm.css` handles global CM layout, `EditorView.theme()` (in `src/ts/codemirror/setup.ts`) handles CM-internal styling within the Shadow-DOM-like CM content area.

### 1.4 Component Count

17 `.tsx` components, each with `className` props referencing CSS classes defined in the CSS files above. Most components use 5-30 distinct class names.

## 2. UnoCSS Overview

**UnoCSS** is an atomic CSS engine that generates CSS on-demand. Key features relevant to this migration:

- **Vite integration:** `@unocss/vite` plugin, runs at build/dev time as a Vite plugin
- **Atomic utility classes:** `flex`, `items-center`, `gap-4`, `p-6`, `text-lg` etc.
- **Presets:** `presetWind` (Tailwind CSS compatible), `presetUno` (default), `presetAttributify` (use HTML attributes like `<div flex>`), `presetIcons` (iconify icons)
- **Theme configuration:** Token-based design system in `uno.config.ts` with colors, font sizes, spacing, breakpoints
- **CSS variable integration:** Map tokens to CSS custom properties for runtime theme switching
- **Dark/light mode:** `dark:` variant prefix or custom `@theme` variants
- **Layer system:** `default`, `base`, `components`, `utilities` — for proper cascade ordering
- **Preflights:** Inject baseline CSS (reset, fonts)
- **Custom rules/shortcuts:** Compose utility patterns into reusable named classes
- **Attributify mode:** Write `flex="~ gap-2"` instead of `className="flex gap-2"` — reduces JSX noise

## 3. Migration Strategy: Gradual Co-existence

**Key principle:** UnoCSS can co-exist with existing CSS. Migrate one file at a time, one component at a time. The old CSS remains in place until its replacement is verified.

### 3.1 Phase order hypothesis (risk-weighted)

```
CSS custom properties (tokens)  ←  foundational, zero risk
    ↓
Layout utilities (flex, grid, spacing)  ←  high-line-count, high-gain
    ↓
Component styles (buttons, inputs, modals)  ←  medium effort
    ↓
Markdown body & typography  ←  high complexity, test-heavy
    ↓
CodeMirror & third-party CSS (hljs, katex)  ←  low gain, high risk
    ↓
Responsive breakpoints  ←  cross-cutting concern
```

## 4. Detailed Implementation Steps

### Phase 0: Install and Configure UnoCSS

#### 4.0.1 Install

```bash
npm install -D unocss @unocss/preset-wind @unocss/preset-attributify
```

#### 4.0.2 Create `uno.config.ts` at project root

```ts
// uno.config.ts
import { defineConfig, presetWind, presetAttributify } from 'unocss';

export default defineConfig({
  presets: [
    presetWind(),          // Tailwind-compatible utilities
    presetAttributify(),   // Attributify mode (optional)
  ],

  // Map the existing CSS custom property tokens into UnoCSS theme config.
  // These become available as utility values: `c-text-1`, `bg-bg-2`, etc.
  theme: {
    colors: {
      // Surfaces
      'bg':        'var(--bg)',
      'bg-2':      'var(--bg-2)',
      'bg-3':      'var(--bg-3)',
      'bg-hover':  'var(--bg-hover)',
      'bg-active': 'var(--bg-active)',

      // Borders
      'border':      'var(--border)',
      'border-mid':  'var(--border-mid)',
      'border-hi':   'var(--border-hi)',
      'border-lo':   'var(--border-lo)',

      // Text
      'text-1': 'var(--text-1)',
      'text-2': 'var(--text-2)',
      'text-3': 'var(--text-3)',

      // Accent
      'accent':       'var(--accent)',
      'accent-dim':   'var(--accent-dim)',
      'accent-glow':  'var(--accent-glow)',

      // Danger
      'danger':    'var(--danger)',
      'danger-bg': 'var(--danger-bg)',
    },

    fontFamily: {
      ui:   'var(--font-ui)',
      mono: 'var(--font-mono)',
    },

    fontSize: {
      'body':     'var(--fs-body)',
      'h1':       'var(--fs-h1)',
      'h2':       'var(--fs-h2)',
      'h3':       'var(--fs-h3)',
      'h4':       'var(--fs-h4)',
      'ui':       'var(--fs-ui)',
      'small':    'var(--fs-small)',
      'tiny':     'var(--fs-tiny)',
      'mono':     'var(--fs-mono)',
      'mono-sm':  'var(--fs-mono-sm)',
      'mono-xs':  'var(--fs-mono-xs)',
      'mono-xxs': 'var(--fs-mono-xxs)',
    },

    borderRadius: {
      'default': 'var(--radius)',
      'lg':      'var(--radius-lg)',
    },
  },

  // Shortcuts: compose utility patterns into reusable named classes.
  // These replace the most commonly repeated CSS patterns.
  shortcuts: {
    // Buttons
    'btn': 'cursor-pointer py-5px px-12px leading-1.4 inline-flex items-center gap-5px whitespace-nowrap border-1 border-solid',
    'btn-primary': 'bg-accent c-white border-accent font-500',
    'btn-icon': 'py-5px px-7px border-transparent bg-transparent',
    'btn-small': 'cursor-pointer py-2px px-10px leading-1.6 border-1 border-solid',
    'btn-disabled': 'cursor-default opacity-35',

    // Input fields
    'input-field': 'w-full bg-bg-3 border-1 border-border-hi border-solid px-11px py-8px outline-none font-mono text-ui c-text-1 rounded-default transition-border',
    'input-field-focus': 'border-accent shadow-[0_0_0_3px_var(--accent-glow)]',

    // Modal
    'modal-overlay': 'fixed inset-0 backdrop-blur-4px z-200',

    // Sidebar
    'file-item': 'flex items-center py-7px px-10px pl-12px cursor-pointer my-1px mx-5px gap-8px',
    'file-item-active': 'bg-accent-glow c-accent border-1 border-solid border-accent/25',

    // Tree view
    'tree-bar': 'flex items-center gap-4px py-2px px-8px cursor-pointer select-none transition-bg transition-color',
    'tree-toggle': 'inline-flex items-center justify-center w-22px h-22px flex-shrink-0 cursor-pointer select-none',

    // Editor
    'tab-btn': 'cursor-pointer border-none bg-transparent py-8px px-16px uppercase border-b-2 border-b-solid border-b-transparent',
    'tab-btn-active': 'c-accent border-b-accent',

    // Dropdowns
    'dropdown-item': 'block w-full py-8px px-14px bg-none border-none cursor-pointer text-left',

    // Context menus
    'context-menu-item': 'block w-full py-7px px-14px bg-none border-none text-left cursor-pointer',
  },

  preflights: [
    {
      getCSS: () => `
        /* Reset — replaces layout.css reset block */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; }

        /* Base body styles (fonts injected by theme CSS as before) */
        body {
          -webkit-font-smoothing: antialiased;
        }

        /* Thin scrollbar (global) */
        * { scrollbar-width: thin; }

        /* CodeMirror font sizing */
        #tab-code .cm-editor { font-size: var(--fs-mono); }

        /* Animations (keep from layout.css) */
        @keyframes dirty-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `,
    },
  ],

  // Variants: enable group-hover, optional
  // variants: [...],
});
```

This config preserves **all** existing CSS custom property tokens — the theme CSS files still define them; UnoCSS just consumes them via `var(--x)`.

#### 4.0.3 Add `@unocss/vite` plugin to `vite.config.ts`

```ts
// Add to the plugins array:
import UnoCSS from '@unocss/vite';

export default defineConfig({
  plugins: [
    UnoCSS(),
    react(),
    // ...existing plugins
  ],
});
```

#### 4.0.4 Import UnoCSS virtual module

In `src/ts/styles.ts` (or `main.tsx`):

```ts
import 'virtual:uno.css';
```

This can co-exist with the existing CSS imports during the migration.

### Phase 1: Replace Theme Files (the token layer)

**Goal:** Stop duplicating the same 870-line CSS file for each theme. Let UnoCSS shortcuts + CSS variables handle the runtime theming, while keeping the token definitions.

#### 4.1.1 Keep the `:root` / `[data-theme="x"]` token blocks

The token definitions **stay** — they define `--bg`, `--text-1`, `--font-ui`, `--fs-body`, etc. for each theme. These ~60 lines per theme (the `[data-theme="dark"] { ... }` blocks with just `--x: value;` declarations) are the **definition**, not the consumption.

**What gets deleted from each theme file:** Every rule block that references `var(--x)` — which is everything after the token definitions. This is approximately 800 lines per theme × 4 themes = **~3,200 lines deleted**.

**Approach:** Create a consolidated `src/css/tokens.css` that contains just the token definitions for all 4 themes, plus the Google Fonts `@import` statements:

```css
/* tokens.css — CSS custom property definitions for all themes.
   UnoCSS consumes these via var(--x) in utilities.   */

/* ── Dark theme ── */
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap');

[data-theme="dark"] {
  --sidebar-w: 220px; --header-h: 56px; --status-h: 30px;
  --bg: #080808; --bg-2: #131313; --bg-3: #1e1e1e;
  --bg-hover: #282828; --bg-active: #333333;
  --border: #2e2e2e; --border-mid: #3e3e3e;
  --border-hi: #585858; --border-lo: #222222;
  --text-1: #faf8f2; --text-2: #ddd6ca; --text-3: #b5aca0;
  --accent: #e0d4b0; --accent-dim: #b8a88a;
  --accent-glow: rgba(224,212,176,.18);
  --danger: #ff5555; --danger-bg: rgba(255,85,85,.15);
  --font-ui: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'DM Mono', 'Menlo', monospace;
  --radius: 6px; --radius-lg: 10px; --transition: .15s ease;
  --fs-body: 17px; --fs-h1: 29px; --fs-h2: 22px;
  --fs-h3: 20px; --fs-h4: 18px; --fs-ui: 16px;
  --fs-small: 14px; --fs-tiny: 13px; --fs-mono: 18px;
  --fs-mono-sm: 16px; --fs-mono-xs: 14px; --fs-mono-xxs: 13px;
}

/* ── Light theme ── */
@import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500&family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;1,400&display=swap');

[data-theme="light"] {
  /* ... same token names, light values ... */
}

/* ── Magenta theme ── */
/* ... */

/* ── Paired-12 theme ── */
/* ... */
```

**Result:** `tokens.css` replaces `theme-dark.css`, `theme-light.css`, `theme-magenta.css`, `theme-paired-12.css`. From ~3,480 lines to ~280 lines.

### Phase 2: Replace `layout.css` (the structure layer)

**Goal:** Replace all structural CSS with UnoCSS utilities + shortcuts. This is the largest single file (1,011 lines).

#### 4.2.1 Categorize `layout.css` rules

| Category | Line count | Migrate to |
|----------|------------|------------|
| Reset (*, *,::before, html) | 3 | UnoCSS preflight |
| App shell flex layout | 5 | UnoCSS utilities on `<div id="app">` |
| Header layout | 20 | UnoCSS utilities on `<Header>` |
| Dropdown menu positioning | 15 | UnoCSS utilities (or Radix handles) |
| Sidebar layout | 15 | UnoCSS utilities on `<Sidebar>` |
| File item / tree layout | 40 | UnoCSS shortcuts `file-item`, `tree-bar` |
| Editor layout (tabs, panels, wrappers) | 35 | UnoCSS utilities on `<EditorWrap>`, `<CodeTab>`, `<ViewTab>`, `<MetaTab>` |
| Buttons layout (padding, sizes) | 10 | UnoCSS shortcut `btn` |
| Modal layout | 12 | UnoCSS utilities on `<Modal>` |
| Toasts layout | 8 | UnoCSS utilities on `<Toast>` |
| Markdown body spacing + typography | 120 | UnoCSS utilities in `.markdown-body` + preflight |
| View/Meta panel layouts | 50 | UnoCSS utilities on respective components |
| History dialog layout | 70 | UnoCSS utilities on `<HistoryDialog>` |
| Trash layout | 80 | UnoCSS utilities on `<TrashView>`, `<TrashPreview>` |
| Login screen layout | 40 | UnoCSS utilities on `<LoginScreen>` |
| Image editor layout | 35 | UnoCSS utilities on `<ImageEditor>` |
| Responsive @media block | 135 | UnoCSS `md:` / `lt-md:` responsive variants |

#### 4.2.2 Migration pattern per component

For each component, replace `className` strings with UnoCSS utility classes:

**Before (Header.tsx, login button):**
```tsx
<button id="btn-signin" className="btn"
  style={{ display: !auth.username && !auth.showLogin ? '' : 'none' }}
  onClick={showLogin}>
  Sign in
</button>
```

**After:**
```tsx
<button id="btn-signin" className="btn"
  hidden={!!(auth.username || auth.showLogin)}
  onClick={showLogin}>
  Sign in
</button>
```

**Before (Sidebar.tsx, toolbar):**
```tsx
<div id="sidebar-toolbar"
  style={{ display: sidebarMode === 'trash' ? 'none' : 'flex' }}>
```

**After:**
```tsx
<div id="sidebar-toolbar"
  className="flex items-center p-2 gap-1.5 border-b-1 border-b-border-mid flex-shrink-0"
  hidden={sidebarMode === 'trash'}>
```

#### 4.2.3 Responsive migration

The current single `@media (max-width: 768px)` block in `layout.css` overrides desktop styles for mobile. With UnoCSS, use responsive variants:

```css
/* Old (layout.css) */
@media (max-width: 768px) {
  #note-area { padding: 16px; }
  #meta-panel { padding: 16px; }
}
```

```html
<!-- New (JSX with UnoCSS) -->
<div class="p-7 lg:p-4">  <!-- padding 28px on desktop, 16px on mobile -->
```

Configure UnoCSS breakpoints:
```ts
// uno.config.ts
export default defineConfig({
  theme: {
    breakpoints: {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
    },
  },
});
```

### Phase 3: Replace Component-Specific CSS

#### 4.3.1 Buttons → UnoCSS shortcut

The `.btn`, `.btn-primary`, `.btn-icon`, `.btn-small` classes become UnoCSS shortcuts. Current usage in 8+ components:

| CSS class | UnoCSS shortcut equivalent |
|-----------|---------------------------|
| `btn` | `btn` (shortcut mapping to `cursor-pointer py-5px px-12px ...`) |
| `btn btn-primary` | `btn btn-primary` |
| `btn-icon` | `btn btn-icon` |
| `btn-small` | `btn-small` (shortcut) |
| `btn-small danger` | `btn-small bg-danger-bg c-danger border-danger/30` |
| `btn-full` | `btn w-full justify-center py-2.25` |

#### 4.3.2 Form inputs → UnoCSS

The `.meta-input`, `meta-textarea`, `.field input` patterns become shortcuts:

```
input-field:  w-full bg-bg-3 border-1 border-border-hi rounded-default ...
input-focus:  focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-glow)]
```

#### 4.3.3 Modal → UnoCSS

`.modal-overlay`, `.modal-content`, `.modal-field` become utilities or shortcuts applied directly on `<Modal>`, `<ConfirmDialog>`, `<LoginScreen>` components.

#### 4.3.4 Markdown body

The `.markdown-body` block (~120 lines of typography/spacing) can become a cascading set of utilities. **However**, since `markdown-it` renders raw HTML into `.markdown-body`, there is no JSX to attach classes to. Two options:

**Option A (recommended):** Keep a small `.markdown-body` CSS file (or preflight) for the regex-rendered content:
```css
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6
{ margin: 1.4em 0 0.6em; }
/* ... ~40 rules for blockquote, code, pre, table, etc. */
```

This is **rendered content** — not component markup — so utility classes don't apply well here. The colors still use `var(--x)` tokens, so they remain theme-switchable.

**Option B:** Use a `prose`-like preset (e.g., `@unocss/preset-typography` or custom `prose` class) that applies rich defaults to `.markdown-body` descendants.

#### 4.3.5 Render-time injected styles

The app injects `mark.search-highlight { background: ...; }` via inline `<style>` for full-text search highlights. This can become a CSS custom property:

```css
mark.search-highlight {
  background: var(--highlight-bg, #ff0);
  color: var(--highlight-fg, #000);
}
```

Then `highlightSearchResults` sets the CSS variables instead of injecting a `<style>` element — simpler and UnoCSS-oblivious.

### Phase 4: Handle Third-Party CSS

#### 4.4.1 highlight.js (`hljs.css`)

**Recommendation: Keep as standalone CSS.** The hljs theme classes are generated by highlight.js at render time — there is no component to attach utilities to. The 238 lines are independent of the rest of the system and already use `var(--bg-3)` for backgrounds.

#### 4.4.2 KaTeX (`katex.css`)

**Recommendation: Keep as-is.** This is a 1-line re-export of KaTeX's CSS. No migration needed.

#### 4.4.3 CodeMirror (`cm.css` + `EditorView.theme()`)

**Current state:**
- `cm.css` (33 lines): Layout + scrollbar for `.cm-editor`, `.cm-scroller`
- `EditorView.theme()` in `setup.ts` (~65 lines): CM-internal styling via CodeMirror's theme extension

**Recommendation:** Keep `cm.css` (small file). The `EditorView.theme()` extension is already a JavaScript object, not CSS — a CSS utility framework doesn't help here. No migration needed.

**Future:** If migrating to `@uiw/react-codemirror` (see separate plan), the `EditorView.theme()` moves to `src/ts/codemirror/cm-theme.ts` — still not CSS.

#### 4.4.4 Spreadsheet (`spreadsheet.css`)

**Option A:** Convert to UnoCSS shortcuts that are applied during spreadsheet render (already in JS):
```ts
// In spreadsheet renderer:
table.className = 'spreadsheet-table border-collapse text-sm font-mono';
```

**Option B:** Keep as-is (62 lines, low complexity).

### Phase 5: Final Cleanup

After all components are migrated:

1. **Delete** `theme-dark.css`, `theme-light.css`, `theme-magenta.css`, `theme-paired-12.css`, `layout.css`
2. **Keep** `tokens.css`, `hljs.css`, `cm.css`, `katex.css`, `spreadsheet.css` (or the migrated versions)
3. **Update** `src/ts/styles.ts` to remove deleted imports
4. **Update** tests that reference DOM class names
5. **Run** visual regression across all 4 themes on desktop + mobile

## 5. File Change Summary

| Action | File | Notes |
|--------|------|-------|
| **Add dep** | `package.json` | `unocss`, `@unocss/preset-wind`, `@unocss/preset-attributify` |
| **Add** | `uno.config.ts` | Theme config, shortcuts, preflights (~150 lines) |
| **Create** | `src/css/tokens.css` | Consolidated theme token definitions (~280 lines, from 4 theme files) |
| **Modify** | `vite.config.ts` | Add `UnoCSS()` plugin |
| **Modify** | `src/ts/styles.ts` (or `main.tsx`) | Add `import 'virtual:uno.css'`, remove deleted CSS imports |
| **Delete** | `src/css/theme-dark.css` | Replaced by tokens.css + UnoCSS |
| **Delete** | `src/css/theme-light.css` | Same |
| **Delete** | `src/css/theme-magenta.css` | Same |
| **Delete** | `src/css/theme-paired-12.css` | Same |
| **Delete** | `src/css/layout.css` | Replaced by UnoCSS utilities in components |
| **Modify** | All 17 `.tsx` components | Replace `className` strings with UnoCSS utility classes |
| **Keep** | `src/css/hljs.css` | highlight.js themes — no migration |
| **Keep** | `src/css/cm.css` | CodeMirror layout — small file |
| **Keep** | `src/css/katex.css` | KaTeX re-export |
| **Keep** | `src/css/spreadsheet.css` | 62 lines, low ROI to migrate |
| **Modify** | `src/ts/hooks/useHotkeys.ts` | If `.cm-content` query changes (shouldn't) |
| **Modify** | Tests | DOM class assertions may change |

**Net CSS change: ~4,800 lines → ~600 lines (tokens + kept files). ~4,200 lines deleted.**

## 6. Migration Order (Recommended)

| Step | Description | Risk | CSS lines |
|------|-------------|------|-----------|
| **1** | Install UnoCSS, create `uno.config.ts`, add Vite plugin, import `virtual:uno.css` | Low | +150 |
| **2** | Extract `tokens.css` from 4 theme files (keep only `--x` definitions), verify all 4 themes still work | Low | -3,200 |
| **3** | Migrate `App.tsx` shell + `Header.tsx` (small, high-visibility) | Low | -50 |
| **4** | Migrate `Sidebar.tsx` + `NoteTree.tsx` (file list, tree, search) | Medium | -120 |
| **5** | Migrate buttons + inputs across all components (shortcuts `btn`, `input-field`) | Medium | -80 |
| **6** | Migrate `EditorWrap.tsx` + tab system (`CodeTab`, `ViewTab`, `MetaTab`) | Medium | -100 |
| **7** | Migrate `Modal.tsx`, `ConfirmDialog.tsx`, `LoginScreen.tsx` | Low | -80 |
| **8** | Migrate `HistoryDialog.tsx`, `TrashView.tsx`, `TrashPreview.tsx` | Medium | -150 |
| **9** | Migrate `Toast.tsx`, `StatusBar.tsx`, `ImageEditor.tsx`, `TagView.tsx` | Low | -80 |
| **10** | Migrate responsive breakpoints (use `md:` variants) | Medium | -135 |
| **11** | Migrate markdown-body typography (limited — keep small CSS file) | High | Keep ~40 |
| **12** | Delete `layout.css`, old theme files, unused CSS imports | Low | -1,011 |
| **13** | Run full test suite + visual regression across themes/devices | — | — |

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **CSS specificity conflicts** | UnoCSS utilities have low specificity (single class). Existing CSS uses `#id` selectors with high specificity. During migration, existing CSS **must** be removed as its rules are replaced, or it will override UnoCSS utilities. Use `!important` guard in preflights only if necessary. |
| **4-theme visual regression** | The token layer stays — `var(--x)` values are identical. The visual output should be pixel-identical because the same CSS properties are applied. Use browser screenshot comparison tools (Playwright, Percy) during transition. |
| **Build performance** | UnoCSS generates CSS on-demand in dev (fast). In production, it outputs a single minified CSS file. The Vite plugin adds negligible build overhead. |
| **Learning curve for contributors** | UnoCSS utility classes are readable and match Tailwind conventions. Provide a cheat sheet in the project README. Shortcuts reduce the need to remember long utility strings. |
| **`@font-face` and `@import` for Google Fonts** | These stay in `tokens.css` — UnoCSS preflights don't handle external font loading well. |
| **Animation keyframes** | Keep in UnoCSS preflight or a small `animations.css` file. UnoCSS doesn't natively generate `@keyframes`. |
| **CSS files loaded by third-party libs (KaTeX, VitePWA)** | These are unaffected — they load their own CSS via their own import paths. |
| **CodeMirror internal styles** | `EditorView.theme()` is not CSS — it's a JS configuration object. Unaffected. |
| **`document.querySelector('.cm-content')` focus trick** | Unaffected — UnoCSS doesn't change DOM class names that CodeMirror generates internally. |

## 8. Success Criteria

- [ ] All 4 themes render identically to pre-migration (pixel comparison)
- [ ] Responsive layout (≤768px) behaves identically
- [ ] All tests pass (updated DOM assertions)
- [ ] Production CSS bundle size reduced (target: 60-70% reduction, from ~40KB to ~12-15KB uncompressed)
- [ ] `npm run dev` starts with no CSS-related errors
- [ ] `npm run build` produces valid hash-named CSS files
- [ ] Custom shortcuts (`btn`, `file-item`, `input-field`) produce the expected output CSS
- [ ] Dynamic `style={{ display: ... }}` props replaced with `hidden={...}` or conditional classes
- [ ] Full-text search highlighting still works (CSS variables set correctly)
- [ ] Scrollbar styling preserved (thin scrollbar on all containers)

## 9. Benefits & ROI Analysis

This project's CSS is already well-architected (clean token separation, consistent class naming, proper scoping). A greenfield project would be an obvious choice for UnoCSS, but as a migration the value must be weighed against the cost of touching every component. Here is an honest breakdown.

### 9.1 Strong benefits

**9.1.1 Theme duplication elimination (~3,200 lines removed)**

The 4 theme files (`theme-dark.css`, `theme-light.css`, `theme-magenta.css`, `theme-paired-12.css`) are ~870 lines each and structurally identical — only the CSS custom property values differ. Every component rule in these files (`[data-theme="dark"] #sidebar`, `[data-theme="light"] .btn`, etc.) is duplicated 4× with the same rules, just different scoping.

With UnoCSS, those rules become utility classes in the JSX, generated once from the `uno.config.ts` shortcuts + `var(--x)` token references. The 4 files collapse into a single `tokens.css` of ~280 lines that only defines the `--x` values:

```
Before:  theme-dark.css     869 lines
         theme-light.css    870 lines
         theme-magenta.css  872 lines
         theme-paired-12.css 874 lines
         ───────────────────────────
         Total             3,485 lines  (all 4 files say the same things)

After:  tokens.css          280 lines   (only the variable definitions)
```

This alone justifies the migration — it's low-risk (tokens are identical), high-impact (massive line reduction), and achievable as a single focused step.

**9.1.2 Dead CSS elimination**

`layout.css` ships 1,011 lines of CSS regardless of which components render. A significant chunk covers trash view, history dialog, image editor, login screen — features the user may never open in a session. UnoCSS scans source files and only generates CSS for utilities actually used in the rendered component tree.

In a note-taking app where most time is spent in the sidebar + editor, you're currently shipping CSS for modals, history diff viewers, and trash banners that may never render. UnoCSS eliminates this overhead automatically.

**9.1.3 Colocation of style and markup**

Currently, to understand how a component looks you need to open `layout.css` + the relevant theme file + the TSX file. With utility classes, the complete visual intent is visible in the JSX:

```tsx
// Before: jump to layout.css + theme-dark.css to know what .file-item looks like
<div className={`file-item${active ? ' active' : ''}`}>

// After: all styling visible inline
<div className={`flex items-center py-1.75 px-2.5 pl-3 cursor-pointer
  my-0.25 mx-1.25 gap-2 rounded-default c-text-2 font-mono
  hover:bg-bg-hover hover:c-text-1 transition
  ${active ? 'bg-accent-glow c-accent border-1 border-accent/25' : ''}`}>
```

For a project with 17 components, this reduces file-jumping during development. The styling intent is co-located with the markup it applies to.

**9.1.4 Smaller production CSS bundle**

Current: ~4,800 lines uncompressed (~40KB). After migration: ~600 lines of hand-written CSS + UnoCSS-generated utilities (only what's used, typically 5-8KB uncompressed). **~80% reduction.**

This matters for a PWA — the project already has `vite-plugin-pwa` and a service worker with `NetworkOnly` caching for API routes. Every KB of CSS must be fetched and parsed on load or on cache-miss. A smaller CSS payload means faster first paint and lower memory pressure.

### 9.2 Marginal benefits

**9.2.1 Responsive ergonomics**

The current single `@media (max-width: 768px)` block at the bottom of `layout.css` overrides desktop styles globally. You read the desktop rule, then scroll 900 lines to find the mobile override. UnoCSS responsive variants (`md:`, `lt-md:`) let you declare mobile overrides directly on the relevant element:

```html
<div class="p-7 md:p-4">  <!-- 28px padding → 16px on mobile, colocated -->
```

Currently 135 lines of media query — with UnoCSS these become inline variants scattered across the components they affect. The gain here is readability, not line count.

**9.2.2 Shortcuts reduce repetition**

Patterns like `.btn`, `.btn-primary`, `.input-field`, `.dropdown-item` appear in multiple components. UnoCSS shortcuts give you a single-source-of-truth alias — if you want to change button padding from `5px 12px` to `6px 14px`, you change it in one place (`uno.config.ts` shortcuts), not in 8 separate components:

```ts
// uno.config.ts — one change affects every <button className="btn">
shortcuts: {
  'btn': 'cursor-pointer py-5px px-12px leading-1.4 inline-flex ...',
}
```

This is a maintenance win but only if you actually use shortcuts instead of spelling out utilities everywhere.

### 9.3 Where UnoCSS adds no value

- **`hljs.css` (238 lines)** — highlight.js injects class names at render time into raw HTML. There is no JSX to attach utilities to. Keep as-is.
- **`katex.css` (1 line)** — KaTeX's own CSS re-export. Keep as-is.
- **`.markdown-body` block (~120 lines in layout.css)** — markdown-it renders raw HTML strings. There is no component markup to colocate utilities with. At best you'd use a `prose` preset, but the gain over a 40-line standalone CSS file is minimal.
- **`EditorView.theme()`** — This is a JavaScript config object passed to CodeMirror, not CSS that UnoCSS can generate. Unaffected by this migration.
- **Animations (`@keyframes`)** — `dirty-pulse`, `toast-in`, `tag-accordion-open`, `spin`. These need a CSS file or preflight block regardless of UnoCSS. No tool eliminates the need for `@keyframes` definitions.

### 9.4 ROI summary

```
Gain:  ~80% CSS reduction (~4,800 → ~600 lines)
        Theme deduplication (4 files → 1 tokens file)
        Dead CSS elimination (ship only what renders)
        Colocation of style + markup in 17 components
        Smaller PWA payload (every KB counts on cache-miss)

Cost:  Touch ~17 components' className props
        Learn UnoCSS utility vocabulary (close to Tailwind, well-documented)
        New dev dependency (unocss + presets, ~2MB on disk)
        Visual regression risk across 4 themes × 2 viewports

Risk:  Low for token consolidation (Phase 1 — just move --x definitions)
        Medium for layout.css replacement (Phase 3+ — each component must be verified)
```

The **concentrated win** is Phase 1: collapsing 4 theme files into `tokens.css`. That's ~3,200 lines removed in a single step with near-zero visual regression risk — the same `var(--x)` tokens resolve to the same values. Everything beyond that (layout.css migration) is additional gain at additional effort, and can be done incrementally component by component. The migration order in Section 6 is designed so you can stop after any phase and still have a working, improved codebase.

