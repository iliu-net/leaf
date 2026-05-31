# Change 036 — Definition List plugin

## Summary

Add `markdown-it-deflist` for Pandoc-style definition lists (`<dl>`).
Terms followed by `:` or `~` definitions render as `<dt>` / `<dd>` pairs.
No options — either enabled or disabled.

## Motivation

Definition lists are a standard HTML element useful for glossaries,
FAQs, metadata tables, and key-value documentation.  Standard Markdown
has no syntax for them, forcing authors into ad-hoc formatting or raw
HTML.  This plugin fills that gap with minimal, readable syntax.

## Usage

```markdown
Term 1
: Definition of term 1

Term 2
~ Definition of term 2 (tilde variant)

Complex Term
: First definition.
: Second definition.

: A definition with multiple paragraphs.

    Indented continuation paragraph.
```

## Architecture

A single block rule intercepts paragraphs followed by `:` or `~` at the
start of the next line, converting them into `<dl>`, `<dt>`, and `<dd>`
tokens.  Loaded lazily (code-split from the main bundle).  No options.

## Files changed

| File | Change |
|---|---|
| `package.json` | Added `markdown-it-deflist` |
| `src/ts/extensions/deflist.ts` | Plugin adapter + system note registration |
| `src/ts/extensions/deflist-docs.md` | In-app help documentation |
| `src/ts/extensions/deflist-module.d.ts` | Ambient module declaration |
| `src/ts/markdown.ts` | Registered `deflist` in `_pluginRegistry` |
| `spa/css/layout.css` | `dl`, `dt`, `dd` structural styles |
| `spa/css/theme-light.css` | `dt` / `dd` text colors |
| `spa/css/theme-dark.css` | `dt` / `dd` text colors |
| `spa/css/theme-magenta.css` | `dt` / `dd` text colors |
| `spa/css/theme-paired-12.css` | `dt` / `dd` text colors |
| `api/config.php` | Added `'deflist'` to default plugins |
| `demo/cookbook/api/config.php` | Added `'deflist'` to default plugins |
| `tests/integration/config.php` | Added `'deflist'` to default plugins |
| `api/config.php-sample` | Added `['deflist']` to examples comment |

## Configuration

No options — on/off only:

```php
$spa_config['markdown']['plugins'] = [
    'deflist',
];
```

## Caveats

- **Term and definition must be adjacent** — a blank line between the
  term and `:` breaks the association.
- **Colon/tilde must have a space after it** — `:Definition` is not
  recognised; it must be `: Definition`.
- **Tilde (`~`) is a valid marker** alongside colon.  Lines starting
  with `~` (e.g. `~/.config`) could be misinterpreted if preceded by
  paragraph text that looks like a term.
- **Nesting is not supported** — definition lists cannot contain nested
  definition lists.  Use indented paragraphs or regular lists.
- **Standard lists are unaffected** — `-`, `*`, and `1.` lists work
  exactly as before.
