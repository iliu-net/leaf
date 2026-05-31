---
title: Abbreviations
---

# Abbreviations

The abbreviations plugin automatically wraps defined abbreviations in
`<abbr>` tags with explanatory `title` text — accessible, hoverable
tooltips without breaking your reading flow.

## Usage

Define an abbreviation anywhere in your document using `*[abbr]: expansion`.
Every plain-text occurrence of the abbreviation is then tagged:

```markdown
The HTML specification is maintained by the W3C.

*[HTML]: HyperText Markup Language
*[W3C]: World Wide Web Consortium
```

Renders the first occurrence of "HTML" and "W3C" as:

> The <abbr title="HyperText Markup Language">HTML</abbr> specification
> is maintained by the <abbr title="World Wide Web Consortium">W3C</abbr>.

The abbreviation tag is only applied to **plain text** — it won't replace
text inside code spans, links, or headings.

### Multi-word abbreviations

Abbreviations can contain multiple words:

```markdown
*[TOC]: Table of Contents
*[SaaS]: Software as a Service
```

### Definitions can be placed anywhere

The `*[abbr]:` definition line can appear before or after the abbreviation
in the text.  The plugin scans the whole document:

```markdown
*[API]: Application Programming Interface

This note documents the API.
```

### Nested definitions

Abbreviation text inside another abbreviation's definition is not
expanded — no infinite loops:

```markdown
*[HTML]: HyperText Markup Language
*[W3C HTML]: The W3C's HTML specification
```

## Configuration

No options.  Add `'abbr'` to `markdown.plugins` to enable:

```php
$spa_config['markdown']['plugins'] = [
    'abbr',
];
```

There is no tuple form — the plugin takes no configuration parameters.

## Caveats

### Only plain text is matched

Abbreviations inside code spans, fenced code blocks, links, and
headings are not tagged.  This prevents `HTML` inside `` `HTML` ``
from being wrapped.

### First-occurrence only (by default)

The plugin tags only the **first** occurrence of each abbreviation on
the page.  This is standard behaviour for accessibility — repeated
`<abbr>` tags on every occurrence would be noisy for screen readers.

### Definitions are hidden

The `*[abbr]: expansion` definition lines are consumed by the plugin
and do not appear in the rendered output.  If you need the definitions
visible, include them separately as regular text.

### Case-sensitive matching

`*[HTML]: …` matches `HTML` but not `html` or `Html`.  Define separate
entries if you need case-insensitive coverage.

### Markdown in definitions is not supported

The expansion text is plain text — no bold, italic, or links inside
the abbreviation title.  The `title` attribute is rendered as-is.
