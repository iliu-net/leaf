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

## Caveats

- Only headings that appear **in the markdown body** are included
  — the note's frontmatter title is rendered separately and won't
  appear in the TOC.
- Headings are limited to levels 1–3 (`#`, `##`, `###`).
  Level 4+ headings (`####` and deeper) are excluded.
