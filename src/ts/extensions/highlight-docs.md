---
title: Syntax Highlighting
---

# Syntax Highlighting

The highlight plugin adds syntax highlighting to fenced code blocks using
[highlight.js](https://highlightjs.org/).

## Usage

Syntax highlighting is automatic — just use fenced code blocks:

````markdown
```python
def greet(name):
    return f"Hello, {name}!"
```
````

## Configuration

The server config (`spa-config`) controls which languages are loaded.
Each language is a separate code-split chunk — only the configured ones
are downloaded.

### Presets

Set the plugin to `"common"` for a curated set of popular languages:

```json
{
  "markdown": {
    "plugins": [["highlight", "common"]]
  }
}
```

This loads: `bash`, `c`, `cpp`, `css`, `diff`, `go`, `html`, `java`,
`javascript`, `json`, `markdown`, `php`, `plaintext`, `python`, `ruby`,
`rust`, `sql`, `typescript`, `xml`, `yaml`.

### Custom list

Specify individual languages, optionally extending the common set:

```json
{ "plugins": [["highlight", ["python", "bash", "sql"]]] }
{ "plugins": [["highlight", ["common", "perl", "tcl"]]] }
```

## Supported languages

| Language | Aliases |
|----------|---------|
| `awk` | |
| `bash` | `sh`, `shell` |
| `c` | |
| `cpp` | |
| `css` | |
| `diff` | |
| `go` | |
| `hcl` | `terraform` |
| `html` | `xml` |
| `ini` | |
| `java` | |
| `javascript` | |
| `json` | |
| `markdown` | `mkd` |
| `nginx` | |
| `perl` | |
| `php` | |
| `plaintext` | `text` |
| `python` | |
| `ruby` | |
| `rust` | |
| `sql` | |
| `tcl` | |
| `typescript` | |
| `vbscript` | `vbs` |
| `yaml` | |
