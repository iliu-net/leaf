---
title: Inline Extras
---

# Inline Extras

The inline extras plugin adds five lightweight markup syntaxes for
semantic inline elements that standard Markdown doesn't cover.

## Usage

| Marker | Example | HTML | Meaning |
|--------|---------|------|---------|
| `++…++` | `++inserted text++` | `<ins>` | Inserted / added text |
| `^^…^^` | `E = mc^^2^^` | `<sup>` | Superscript |
| `,,…,,` | `H,,2,,O` | `<sub>` | Subscript |
| `==…==` | `Press ==Enter==` | `<kbd>` | Keyboard input |
| `??…??` | `??important note??` | `<mark>` | Highlighted text |

All five markers are **balanced** — the same two characters open and close
the span.  Inner content is parsed as markdown, so you can combine with
other formatting:

```markdown
++**important** addition++
^^a link to [[some page]]^^
```

### Word-boundary rules

For `++`, `==`, and `??`, the opening delimiter must not be preceded by
a word character, and the closing delimiter must not be followed by one.
This prevents accidental matches:

- `C++` is not treated as an opening `++` marker (it follows `C`)
- Trailing question marks like `what??` are not treated as a `??` marker
- `x==5` in code is not mistaken for `<kbd>`

`^^` and `,,` **skip** the word-boundary guard so that chemical formulas
(`H,,2,,O`) and math notation (`mc^^2^^`, `x^^n^^`) work naturally.

If you need a literal `++`, `^^`, `,,`, `==`, or `??` that would be
misinterpreted, put it in a code span: `` `++` ``.

## Configuration

No options.  Add `'inline-extras'` to `markdown.plugins` to enable:

```php
$spa_config['markdown']['plugins'] = [
    'inline-extras',
];
```

There is no tuple form — the plugin takes no configuration parameters
and all five markers are always active together.

## Caveats

### All markers are on or off together

The five markers cannot be enabled individually.  If you prefer to use
only some of them, leave the plugin disabled and use raw HTML for the
ones you need (`<ins>...</ins>`, `<sup>...</sup>`, etc.).

### No empty spans

`++++` (empty insert) renders as literal `++++`, not as `<ins></ins>`.
Content must be non-empty.

### Multiline not supported

These are **inline** markers — they must appear within a single
paragraph.  A line break between the opening and closing delimiter
prevents matching.

### Nesting of the same type is not supported

`++outer ++inner++ text++` is ambiguous and will not produce nested
`<ins>` elements.  Use raw HTML if you need that.

### Browser default styling

`<sup>` and `<sub>` use browser defaults (raised/lowered, smaller font).
`<ins>` is styled with an underline.  `<kbd>` gets a monospace keycap
look.  `<mark>` gets a highlighted background.  All are theme-aware.
