# Change 037 — Abbreviation plugin

## Summary

Add `markdown-it-abbr` to automatically wrap defined abbreviations in
`<abbr title="…">` tags.  Define `*[abbr]: expansion` anywhere in the
document; every plain-text occurrence gets a hoverable tooltip.

## Motivation

Abbreviations without explanations create friction — readers either
already know them or have to search.  `<abbr>` provides a standard,
accessible way to surface the expansion on hover, with no visual noise
in the main text and no raw HTML required.

## Usage

```markdown
The HTML specification is maintained by the W3C.

*[HTML]: HyperText Markup Language
*[W3C]: World Wide Web Consortium
```

Renders the first occurrence of each abbreviation as:

```html
<abbr title="HyperText Markup Language">HTML</abbr>
```

Definitions are consumed by the plugin and hidden from rendered output.

## Architecture

An inline rule matches plain-text occurrences of defined abbreviations
and replaces them with `<abbr>` tokens.  Loaded lazily (code-split).
No options — on/off only.

## Files changed

| File | Change |
|---|---|
| `package.json` | Added `markdown-it-abbr` |
| `src/ts/extensions/abbr.ts` | Plugin adapter + system note registration |
| `src/ts/extensions/abbr-docs.md` | In-app help documentation |
| `src/ts/extensions/abbr-module.d.ts` | Ambient module declaration |
| `src/ts/markdown.ts` | Registered `abbr` in `_pluginRegistry` |
| `spa/css/layout.css` | `abbr` dotted underline + help cursor |
| `spa/css/theme-light.css` | `abbr` text and underline color |
| `spa/css/theme-dark.css` | `abbr` text and underline color |
| `spa/css/theme-magenta.css` | `abbr` text and underline color |
| `spa/css/theme-paired-12.css` | `abbr` text and underline color |
| `api/config.php` | Added `'abbr'` to default plugins |
| `demo/cookbook/api/config.php` | Added `'abbr'` to default plugins |
| `tests/integration/config.php` | Added `'abbr'` to default plugins |
| `api/config.php-sample` | Added `['abbr']` to examples comment |

## Configuration

No options:

```php
$spa_config['markdown']['plugins'] = [
    'abbr',
];
```

## Caveats

- **Plain text only.**  Abbreviations inside code spans, fenced blocks,
  links, and headings are not tagged.
- **First occurrence only.**  Only the first instance of each abbreviation
  is wrapped — repeated `<abbr>` tags would be noisy for screen readers.
- **Definitions are hidden.**  `*[abbr]: expansion` lines are consumed
  and never appear in rendered output.
- **Case-sensitive.**  `*[HTML]: …` matches `HTML` but not `html`.
- **No markdown in definitions.**  The expansion text is plain text —
  no formatting inside the `title` attribute.
