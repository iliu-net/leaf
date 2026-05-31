---
title: Definition Lists
---

# Definition Lists

The definition list plugin adds Pandoc-style `<dl>` (definition list)
support — terms paired with their definitions.

## Usage

Write a term on one line, followed by `:` or `~` and the definition on
the next line:

```markdown
Term 1
: Definition of term 1

Term 2
~ Definition of term 2 (tilde variant)
```

Renders as:

> **Term 1**
> Definition of term 1
>
> **Term 2**
> Definition of term 2 (tilde variant)

### Multiple definitions per term

A single term can have multiple definitions:

```markdown
Term
: First definition.
: Second definition.
```

### Multi-paragraph definitions

Indent continuation lines to include multiple paragraphs or block
elements in a definition:

```markdown
Complex Term
: First paragraph.

    Second paragraph — indented by 4 spaces.

: Another definition with a list:

    - Item one
    - Item two
```

### Inline markdown in definitions

Definitions support full inline markdown:

```markdown
**Bold Term**
: Definition with `code`, *italic*, and [[wikilinks]].
```

## Configuration

No options.  The plugin is entirely on/off: add `'deflist'` to
`markdown.plugins` to enable it.

```php
$spa_config['markdown']['plugins'] = [
    'deflist',
];
```

There is no tuple form — the plugin takes no configuration parameters.

## Caveats

### Term and definition must be adjacent

A blank line between the term and its `:` definition breaks the
association:

```markdown
Term
                         ← blank line breaks it
: This becomes a separate paragraph starting with ":"
```

### Colon must have a space after it

`:Definition` without a space is not recognized — it must be
`: Definition` with a space between the colon and the text.

### Tilde variant

Both `:` and `~` are recognized as definition markers.  This matches
the Pandoc spec, but be aware that a line starting with `~` (e.g.
`~/.config`) in your markdown could be misinterpreted if preceded by
a paragraph that looks like a term.

### Nesting is not supported

Definition lists do not nest — you cannot put a definition list inside
a definition.  Use indented paragraphs or regular lists instead.

### Standard lists are unaffected

Unordered (`-`, `*`) and ordered (`1.`) lists work exactly as before.
The definition list syntax only activates when a paragraph-like line is
immediately followed by `:` or `~` at the start of the next line.
