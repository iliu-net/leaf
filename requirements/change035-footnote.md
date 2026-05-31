# Change 035 — Footnote plugin

## Summary

Add `markdown-it-footnote` for Pandoc-style footnotes with bidirectional
linking.  Supports normal references (`[^label]` / `[^label]: definition`)
and inline notes (`^[content]`).  Rendered footnotes collect at the end
of the markdown body with back-links to each reference point.

## Motivation

Footnotes are a fundamental academic and technical writing tool.  Without
them, authors resort to parenthetical asides, HTML `<sup>` tags, or
awkward end-of-document manual numbering.  A proper footnote system keeps
the main text clean while providing detail for interested readers.

## Usage

```markdown
Here is a footnote reference,[^1] and another.[^longnote]

Here is an inline note.^[Inline notes are easier to write.]

[^1]: Here is the footnote.

[^longnote]: Here's one with multiple blocks.

    Subsequent paragraphs are indented to show that they
belong to the previous footnote.
```

## Architecture

The plugin is loaded lazily (code-split from the main bundle).  It
registers three rules:

- `footnote_def` — block rule for `[^label]: definition` at document level
- `footnote_inline` — inline rule for `^[content]` in text
- `footnote_ref` — inline rule for `[^label]` references in text
- `footnote_tail` — core rule that collects footnotes and appends them
  after the document body

No configuration options — either enabled or disabled.

## Files changed

| File | Change |
|---|---|
| `package.json` | Added `markdown-it-footnote` |
| `src/ts/extensions/footnote.ts` | Plugin adapter + system note registration |
| `src/ts/extensions/footnote-docs.md` | In-app help documentation |
| `src/ts/extensions/footnote-module.d.ts` | Ambient module declaration |
| `src/ts/markdown.ts` | Registered `footnote` in `_pluginRegistry` |
| `spa/css/layout.css` | Footnote structural styles (sep, list, ref superscript, backref) |
| `spa/css/theme-light.css` | Footnote ref/backref/sep colors |
| `spa/css/theme-dark.css` | Footnote ref/backref/sep colors |
| `spa/css/theme-magenta.css` | Footnote ref/backref/sep colors |
| `spa/css/theme-paired-12.css` | Footnote ref/backref/sep colors |
| `api/config.php` | Added `'footnote'` to default plugins |
| `demo/cookbook/api/config.php` | Added `'footnote'` to default plugins |
| `tests/integration/config.php` | Added `'footnote'` to default plugins |
| `api/config.php-sample` | Added `['footnote']` to examples comment |

## Configuration

No options.  Activate by adding the plain string:

```php
$spa_config['markdown']['plugins'] = [
    'footnote',
];
```

There is no tuple form — the plugin accepts no configuration parameters.

## Caveats

- **Footnotes render at the end of `markdown-body`**, after all body
  content but before Leaf's view stats and system info sections.
- **Footnote labels must be unique** — duplicate definitions cause the
  last one to silently win.
- **Inline footnotes are anonymous** — `^[content]` creates a footnote
  that cannot be referenced again from elsewhere in the document.
- **Labels cannot contain spaces** — `[^my label]` is invalid.
- **Block content in definitions must be indented** — 4 spaces or 1 tab
  relative to the `[^label]:` line.
- **Footnotes are view-only** — they render in the View tab but there
  is no editing UI in the editor; you write the markdown syntax directly.
