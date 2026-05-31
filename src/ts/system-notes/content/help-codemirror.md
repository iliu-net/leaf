---
title: CodeMirror Usage
---

# CodeMirror Usage

The Code tab provides a full code editor powered by CodeMirror.

## Syntax highlighting

The editor automatically detects the language from the frontmatter `lang` field.

## Supported languages

Set `lang` in the META tab to one of:

- `markdown`, `javascript`, `typescript`, `json`, `css`, `html`
- `python`, `php`, `java`, `cpp`, `c`, `rust`, `go`, `ruby`, `perl`
- `sql`, `yaml`, `xml`, `tcl`, `bash`, `awk`, `ini`, `nginx`
- More available via plugins

## WikiLink autocomplete

Typing `[[` triggers a completion dialog listing all available notes.  Continue
typing to filter the list, then pick a note with `Enter` or click.  The full
`[[note-id]]` syntax is inserted automatically.

Press `Ctrl+Space` to re-open the dialog at any time while inside a `[[…`
context.

## Features

- WikiLink autocomplete (`[[`)
- Line numbers
- Bracket matching
- Code folding
- Multiple selections
- Search and replace (`Ctrl+F`)
