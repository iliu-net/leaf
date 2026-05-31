# Change 032 — Table of Contents plugin

## Summary

Add `markdown-it-toc-done-right` to auto-generate a linked table of
contents from document headings.  The placeholder `[TOC]` (or `[toc]`,
`[[toc]]`, `${toc}`) on its own line is replaced with a `<nav>` list
linking to every heading level 1–3 in the markdown body.

## Motivation

Long notes benefit from a quick overview of their structure.  A TOC
lets readers jump directly to the section they need without scrolling
through the entire document.

## Usage

Place `[TOC]` on its own line:

```markdown
# My Note

[TOC]

## Introduction
...

## Details
...

### Sub-section
...
```

## Architecture

The plugin is loaded lazily (code-split away from the main bundle) and
registered as a markdown-it block rule.  It intercepts the placeholder
line before the heading parser, injects `tocOpen` / `tocBody` /
`tocClose` tokens, and a core rule builds the heading tree from parsed
tokens.  Styling uses theme-aware CSS custom properties via
`layout.css`.

## Files changed

| File | Change |
|---|---|
| `package.json` | Added `markdown-it-toc-done-right` |
| `src/ts/extensions/toc.ts` | Plugin adapter + system note registration |
| `src/ts/extensions/toc-docs.md` | In-app help documentation |
| `src/ts/markdown.ts` | Registered `toc` in `_pluginRegistry` |
| `spa/css/layout.css` | `.table-of-contents` styles |
| `api/config.php` | Added `'toc'` to default plugins |
| `demo/cookbook/api/config.php` | Added `'toc'` to default plugins |

## Configuration

No options required.  Activate by adding `"toc"` to `markdown.plugins`:

```json
{
  "markdown": {
    "plugins": ["emoji", "wikilinks", "toc"]
  }
}
```

Per-instance overrides are supported via tuple syntax:

```php
['toc', ['level' => [2, 3], 'listType' => 'ul']]
```

## Caveats

- Only headings in the markdown body are indexed — the note's
  frontmatter title (rendered as `<h1>` outside markdown-it) does not
  appear in the TOC.
- Heading depth is capped at level 3 (`#`, `##`, `###`).
  Level 4+ headings are excluded.
