---
title: MultiMarkdown Tables
---

# MultiMarkdown Tables

The MultiMarkdown tables plugin extends Leaf's table syntax with advanced
features from the [MultiMarkdown 6 specification][mmd6].  Standard pipe
tables still work — everything here is additional.

[mmd6]: https://fletcher.github.io/MultiMarkdown-6/syntax/tables.html

## Usage

### Column spans

End a cell with `||` to make it span the next column:

```markdown
|             |          Grouping           ||
First Header  | Second Header | Third Header |
 ------------ | :-----------: | -----------: |
Content       |          *Long Cell*        ||
Content       |   **Cell**    |         Cell |
```

The first row has "Grouping" in column 2 spanning into column 3.  The
body row has "*Long Cell*" in column 2 also spanning into column 3.

### Table captions

Add a caption by writing it in brackets on the line immediately after
the table.  Captions also serve as accessible labels for screen readers:

```markdown
| Item | Qty | Price |
|------|----:|------:|
| Widget | 10 | $1.50 |
| Gizmo  | 4  | $3.00 |
[Sales Summary Q1]
```

The caption text is slugified to produce an `id` on the `<caption>`
element (e.g. `id="salessummaryq1"`), so you can link directly to
a table with `#salessummaryq1`.

### Multiple tbody sections

A blank line between table rows creates a new `<tbody>`.  This lets you
visually group rows:

```markdown
| Item | Qty |
|------|-----|
| Alpha | 2 |
| Beta  | 5 |

| Gamma | 1 |
| Delta | 3 |
```

### Headerless tables

Omit the header row above the separator to create a table with no
`<thead>`.  The separator line alone (`|---|---|`) followed by data
rows is enough:

```markdown
|--|--|--|
|♜|♞|♝|
|♟|♟|♟|
```

## Optional features

The following are disabled by default.  Enable them via tuple config
(see Configuration below):

### Row spans (opt-in)

Use `^^` in a cell to merge it with the cell above:

```markdown
Stage | Products | Yields
----: | -------: | -----:
Glycolysis | 2 ATP ||
^^ | 2 NADH | 5 ATP |
Citric acid | 2 NADH | 5 ATP |
^^ | 2 FADH2 | 3 ATP |
```

### Multiline cells (opt-in)

End a line with `\` to continue the cell content on the next line:

```markdown
| Markdown   | Rendered HTML |
|------------|---------------|
| *Italic*   | *Italic*      | \
|            |               |
```

## Configuration

The plugin accepts these options:

| Option | Type | Default | Description |
|---|---|---|---|
| `multiline` | boolean | `false` | `\` at end of line merges with content below |
| `rowspan` | boolean | `false` | `^^` in a cell merges with the cell above |
| `headerless` | boolean | `true` | Allow tables without header rows |
| `multibody` | boolean | `true` | Blank lines between rows create `<tbody>` sections |
| `autolabel` | boolean | `true` | Generate `id` on `<caption>` from caption text |

### Server config examples

**Default (colspan, headerless, multibody, captions):**

```php
$spa_config['markdown']['plugins'] = [
    'multimdtable',
];
```

**Enable rowspan and multiline cells:**

```php
$spa_config['markdown']['plugins'] = [
    ['multimdtable', ['rowspan' => true, 'multiline' => true]],
];
```

**Enable everything:**

```php
$spa_config['markdown']['plugins'] = [
    ['multimdtable', [
        'multiline'  => true,
        'rowspan'    => true,
        'headerless' => true,
        'multibody'  => true,
        'autolabel'  => true,
    ]],
];
```

## Caveats

### Standard pipe tables still work

This plugin extends the built-in table parser.  All existing `|---|`
tables continue to render exactly as before.  New syntax (`||`, `^^`,
`[caption]`) is only active when you use it.

### Rowspan and multiline are opt-in

`rowspan` and `multiline` are disabled by default because `^^` and
trailing `\` could appear in existing markdown with different meaning.
`headerless` is enabled by default — a `|---|---|` line followed by
pipe rows is unambiguously a table.

### Captions must be on the line immediately after the table

A blank line between the table body and the `[caption]` breaks the
association — the caption becomes a regular paragraph.

### Colspan vs empty cells

A cell that genuinely contains nothing is different from one that ends
with `||`:

```markdown
| A |   | C |    ← three separate cells, middle one empty
| A ||    C |    ← two cells, first spans into second column
```

### Alignment is preserved

Column alignment (`:---`, `:---:`, `---:`) works exactly as with
standard pipe tables and is combined with col/row spans.

### Markdown inside cells

The text in table cells is parsed as inline markdown, so you can use
`**bold**`, `*italic*`, `` `code` ``, links, and wikilinks as usual.
