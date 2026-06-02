---
title: Spreadsheet Blocks
---

# Spreadsheet Blocks

The spreadsheet plugin lets you embed CSV data with formula support
directly in your notes.  Cells starting with `=` are evaluated as
formulas using standard spreadsheet syntax.

## Usage

Use `spreadsheet` or `calc` as the language tag on a fenced code block:

````markdown
```spreadsheet
Item,Price,Qty,Total
Widget,10.00,3,=B2*C2
Gadget,15.50,2,=B3*C3
,,Subtotal,=SUM(D2:D3)
```
````

### Supported formula syntax

- **Arithmetic:** `+` `-` `*` `/` `^`
- **Comparisons:** `=` `<>` `<` `>` `<=` `>=`
- **Cell references:** `A1`, `B2` (A1 notation)
- **Ranges:** `SUM(A1:A5)`, `AVERAGE(B2:D2)`
- **String literals:** `"hello"` (double-quoted)

### Common functions

`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`,
`ROUND`, `ROUNDUP`, `ROUNDDOWN`, `ABS`, `SQRT`, `POWER`,
`CONCATENATE`, `LEFT`, `RIGHT`, `MID`, `LEN`, `TRIM`,
`UPPER`, `LOWER`, and many more.

> **Note:** The parser evaluates all formulas at render time into a
> static HTML table.  This is not an interactive spreadsheet — the
> table is read-only.

## Configuration

Add `"spreadsheet"` to the `markdown.plugins` list in your spa-config:

```json
{
  "markdown": {
    "plugins": ["spreadsheet"]
  }
}
```

No additional options are required.
