---
title: Footnotes
---

# Footnotes

The footnotes plugin adds Pandoc-style footnote support — references
in the text body with definitions collected at the bottom.

## Usage

### Normal footnotes

Create a reference in the text with `[^label]`, then define it anywhere
in the document with `[^label]: definition`:

```markdown
Here is a footnote reference,[^1] and another.[^longnote]

[^1]: Here is the footnote.

[^longnote]: Here's one with multiple blocks.

    Subsequent paragraphs are indented to show that they
belong to the previous footnote.
```

Renders as:

> Here is a footnote reference,¹ and another.²
>
> ---
> ¹ Here is the footnote. ↩
> ² Here's one with multiple blocks.
>
> Subsequent paragraphs are indented to show that they belong to the previous footnote. ↩

### Inline footnotes

Use `^[content]` for a quick footnote without a separate label:

```markdown
Here is an inline note.^[Inline notes are easier to write, since
you don't have to pick an identifier and move down to type the note.]
```

The footnote content is collected and numbered automatically.

### Multiple references to the same footnote

Refer to the same footnote definition multiple times:

```markdown
First reference[^fn] and second reference[^fn] point to the same
definition.

[^fn]: This footnote appears once but is referenced twice.
```

Each reference gets its own back-link (`↩`), all pointing to the same
definition.

### Block content in footnotes

Footnote definitions can contain block-level markdown — lists, code
blocks, quotes — by indenting them:

```markdown
[^blocks]: Here is a footnote with a list:

    - First item
    - Second item

    And a code block:

        echo "hello"
```

## Configuration

No options.  The plugin is entirely on/off: add `'footnote'` to
`markdown.plugins` to enable it, remove it to disable.

```php
$spa_config['markdown']['plugins'] = [
    'footnote',
];
```

There is no tuple form — the plugin takes no configuration parameters.

## How it works

Each footnote reference in the text is rendered as a superscript link
(`<sup class="footnote-ref">`) to the corresponding definition at the
bottom of the markdown body.  Each definition item has a back-link
(`<a class="footnote-backref">↩</a>`) that scrolls back to the reference.

## Caveats

### Footnotes appear at the end of the markdown body

The rendered footnote list is appended to `markdown-body`, after all
other content.  It does not appear below the frontmatter stats or
system info sections — those are rendered separately by Leaf's view
layer.

### Footnote labels must be unique

Each `[^label]` definition must have a distinct label.  Duplicate
labels in definitions will cause the last definition to win.

### Inline footnotes can't be referenced again

`^[content]` creates an anonymous footnote.  There is no way to
reference the same inline footnote from elsewhere in the document.
If you need multiple references to the same note, use a normal
`[^label]` definition.

### Label naming restrictions

- Labels can contain letters, numbers, hyphens, and underscores.
- Labels cannot contain spaces.
- Empty labels (`[^]`) are not supported.

### Indentation matters in definitions

Block content inside a footnote definition must be indented by
4 spaces or 1 tab relative to the `[^label]:` line:

```markdown
[^example]: First paragraph.

    Second paragraph — indented by 4 spaces.

Un-indented text breaks out of the footnote.
```

### Footnotes are view-only

Like task list checkboxes and TOC links, footnotes render in the
View tab.  There is no editing UI for them in the editor — you write
the markdown syntax directly.
