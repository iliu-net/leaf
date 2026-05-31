# Change 034 — MultiMarkdown Table plugin

## Summary

Add `markdown-it-multimd-table` to support MultiMarkdown 6 table syntax:
colspan (`||`), rowspan (`^^`), table captions (`[caption]`), multiple
`<tbody>` sections, headerless tables, and multiline cells.  Standard
pipe tables continue to work unchanged.

## Motivation

Standard Markdown tables lack `colspan`, `rowspan`, and captions —
forcing users into raw HTML for anything beyond a basic grid.  The
MultiMarkdown spec extends the familiar pipe-table syntax with these
features using minimal, readable additions.

## Usage

```markdown
|             |          Grouping           ||
First Header  | Second Header | Third Header |
 ------------ | :-----------: | -----------: |
Content       |          *Long Cell*        ||
Content       |   **Cell**    |         Cell |

[Prototype table]
```

| Feature | Syntax | Default |
|---|---|---|
| Column span | `\|\|` at end of cell | enabled |
| Captions | `[text]` line after table | enabled |
| Multiple bodies | Blank line between rows | enabled |
| Row span | `^^` in cell | disabled |
| Headerless | No header row above `\|---\|` | enabled |
| Multiline cells | `\` at end of line | disabled |

## Architecture

The plugin is loaded lazily (code-split, 14.7 KB chunk).  It replaces
markdown-it's built-in table parser with one that extends the pipe-table
grammar to recognise MultiMarkdown extensions.  The wrapper exposes
five boolean options.  `rowspan` and `multiline` are disabled by default
(they can reinterpret existing text).  `headerless` is enabled by default
(a `|---|---|` line followed by pipe rows is unambiguously a table).

## Files changed

| File | Change |
|---|---|
| `package.json` | Added `markdown-it-multimd-table` |
| `src/ts/extensions/multimd-table.ts` | Plugin adapter + system note registration |
| `src/ts/extensions/multimd-table-docs.md` | In-app help documentation |
| `src/ts/markdown.ts` | Registered `multimdtable` in `_pluginRegistry` |
| `spa/css/layout.css` | `caption` and `tbody + tbody` structural styles |
| `spa/css/theme-light.css` | Caption and tbody border colors |
| `spa/css/theme-dark.css` | Caption and tbody border colors |
| `spa/css/theme-magenta.css` | Caption and tbody border colors |
| `spa/css/theme-paired-12.css` | Caption and tbody border colors |
| `api/config.php` | Added `'multimdtable'` to default plugins |
| `demo/cookbook/api/config.php` | Added `'multimdtable'` to default plugins |
| `tests/integration/config.php` | Added `'multimdtable'` to default plugins |
| `api/config.php-sample` | Added `['multimdtable']` to examples comment |

## Configuration

Activate with the plain string (sensible defaults — colspan, headerless,
captions, multibody on; rowspan, multiline off):

```php
$spa_config['markdown']['plugins'] = [
    'multimdtable',
];
```

Enable rowspan and multiline:

```php
$spa_config['markdown']['plugins'] = [
    ['multimdtable', ['rowspan' => true, 'multiline' => true]],
];
```

### Options reference

| Option | Type | Default | Description |
|---|---|---|---|
| `multiline` | boolean | `false` | `\` at end of line merges with content below |
| `rowspan` | boolean | `false` | `^^` in a cell merges with cell above |
| `headerless` | boolean | `true` | Allow tables without a header row above `\|---\|` |
| `multibody` | boolean | `true` | Blank lines between rows create `<tbody>` sections |
| `autolabel` | boolean | `true` | Generate `id` on `<caption>` from caption text |

## Caveats

- **Standard tables unaffected.**  All existing `|---|` tables work
  exactly as before.  New syntax is only active when used.
- **Rowspan and multiline are opt-in** because `^^` and trailing `\`
  could appear in existing markdown with different meaning.
  `headerless` is enabled by default — a standalone `|---|---|`
  separator followed by pipe rows is unambiguous table syntax.
- **Captions must immediately follow the table.**  A blank line breaks
  the association and the caption becomes a regular paragraph.
- **Colspan uses `||` vs empty cells.**  `| A |   | C |` is three cells
  (middle empty); `| A ||    C |` is two cells (first spans).
- **Duplicate caption text** produces the same `id` — the plugin
  handles this by appending a numeric suffix (`-1`, `-2`, …).
