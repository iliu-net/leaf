---
title: Table of Contents
---

# Table of Contents

The TOC plugin auto-generates a linked table of contents from your
document headings.

## Usage

Place `[TOC]` on its own line in your markdown.  It will be replaced
with an ordered list of links to every heading in the document:

```markdown
# My Note

[TOC]

## Introduction

Some text...

## Details

More here...

### Sub-section

Even deeper...
```

## Supported spellings

All of the following are recognised (case-insensitive):

| Placeholder | Description |
|---|---|
| `[TOC]` | Simple, readable |
| `[toc]` | Lowercase |
| `[[toc]]` | Wikilink style |
| `${toc}` | Template style |

## How it works

Each heading in your markdown body gets an `id` attribute based on its
text (slugified).  The TOC links to these IDs so the browser can scroll
directly to the target section when you click a TOC entry.

You can also link to headings from other notes using wikilinks with
a fragment:

```markdown
[[my-note#details]]
```

## Caveats

- Only headings that appear **in the markdown body** are included
  — the note's frontmatter title is rendered separately and won't
  appear in the TOC.
- Headings are limited to levels 1–3 (`#`, `##`, `###`).
  Level 4+ headings (`####` and deeper) are excluded.
- Duplicate heading text gets a numeric suffix (`-1`, `-2`, …)
  to keep IDs unique.
