# Change 038 — Inline Extras plugin

## Summary

Add a custom markdown-it plugin providing five inline markup syntaxes
for semantic HTML elements that standard Markdown does not cover:
`++` → `<ins>`, `^^` → `<sup>`, `,,` → `<sub>`, `==` → `<kbd>`,
`??` → `<mark>`.

## Motivation

Standard Markdown provides no syntax for inserted text, superscript,
subscript, keyboard input, or text highlighting.  Authors resort to
raw HTML (`<ins>…</ins>`, `<kbd>…</kbd>`) which breaks reading flow
in plain-text views and the CodeMirror editor.  These five lightweight
markers solve the most common cases with minimal visual noise.

This is the "Custom plugin" item from the Markdown TODO list.

## Usage

```markdown
++inserted text++           → <ins>inserted text</ins>
E = mc^^2^^                 → E = mc<sup>2</sup>
H,,2,,O                     → H<sub>2</sub>O
Press ==Enter== to submit   → Press <kbd>Enter</kbd> to submit
??important note??          → <mark>important note</mark>
```

All five markers are balanced (same two characters open and close).
Inner content is parsed as markdown, so combining with other formatting
works:

```markdown
++**bold** addition++
^^a link to [[some page]]^^
```

### Word-boundary guards

The opening delimiter must not be preceded by a word character, and the
closing delimiter must not be followed by one.  This prevents accidental
matches:

- `C++` is not mistaken for an opening `++` marker
- Trailing `??` in `what??` is not treated as a highlight marker
- `x==5` in code-like contexts is not mistaken for `<kbd>`

## Architecture

A single custom inline rule (`inline_extras`) is inserted before the
text rule via `md.inline.ruler.before('text')`.  The built-in text rule
is replaced with a copy that also treats `,` (0x2C) and `?` (0x3F) as
terminator characters — the stock text rule skips past them, which would
prevent `,,` and `??` syntax from working mid-paragraph.  The
replacement is identical to the original except for the two added
switch-cases.

The rule scans for any of the five marker strings, finds the matching
close delimiter, and emits an `html_inline` token wrapping the
`<tag>parsed-inner-content</tag>`.

Inner content is parsed with `md.renderInline()` so nested markdown
(emphasis, wikilinks, code spans) works inside these spans.

No npm dependency — pure custom rule, similar to wikilinks.ts.
Loaded lazily (code-split).  No options — all five markers are active
together.

## Files changed

| File | Change |
|---|---|
| `src/ts/extensions/inline-extras.ts` | Custom plugin: inline rule + tag map |
| `src/ts/extensions/inline-extras-docs.md` | In-app help documentation |
| `src/ts/markdown.ts` | Registered `inline-extras` in `_pluginRegistry` |
| `api/config.php` | Added `'inline-extras'` to default plugins |
| `api/config.php-sample` | Added `inline-extras` to examples comment |
| `demo/cookbook/api/config.php` | Added `'inline-extras'` to default plugins |
| `tests/integration/config.php` | Added `'inline-extras'` to default plugins |
| `spa/css/layout.css` | Structural styles for `ins`, `mark` |
| `spa/css/theme-light.css` | `ins` and `mark` theme colors |
| `spa/css/theme-dark.css` | `ins` and `mark` theme colors |
| `spa/css/theme-magenta.css` | `ins` and `mark` theme colors |
| `spa/css/theme-paired-12.css` | `ins` and `mark` theme colors |
| `TODO/markdown.md` | Marked custom plugin item as done |

(`kbd` already had layout + theme styles from a previous change;
`sup`/`sub` rely on browser defaults.)

## Configuration

No options — on/off only:

```php
$spa_config['markdown']['plugins'] = [
    'inline-extras',
];
```

## Caveats

- **All five markers are always active together** — cannot enable
  individual markers.  Use raw HTML if you only need a subset.
- **No empty spans** — `++++` renders as literal text, not as
  `<ins></ins>`.
- **Multiline not supported** — opening and closing delimiters must be on
  the same line.
- **Self-nesting not supported** — `++a ++b++ c++` does not produce
  nested `<ins>` elements.
- **`++` after word characters** (like `C++`) is not matched thanks to
  the word-boundary guard.  Use a code span `` `++` `` if you need
  literal markers that would otherwise be misinterpreted.
- **`??` at end of question** (like `what??`) is not matched for the
  same reason — the opening `??` is preceded by `t`, a word character.
- **`mark` vs search-highlight** — the `<mark>` element from this plugin
  is distinct from `mark.search-highlight` used for in-note search
  results.  Search highlights use a separate CSS class and are
  unaffected.
- **Chemical formulas** — `H,,2,,O` will not render as `H<sub>2</sub>O`
  because the `H` before `,,` is a word character, triggering the
  word-boundary guard.  Workaround: write `H ,,2,, O` with spaces, or
  use raw `H<sub>2</sub>O`.
