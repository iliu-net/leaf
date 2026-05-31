# Change 030 — Template expansion for markdown notes

## Summary

Add Eta-based template expansion as a pre-processing step before markdown
rendering. When a note's frontmatter contains `template: true`, the body is
passed through Eta with access to the current note's frontmatter (`$.meta`),
the server SPA config (`$.config`), and any notes listed in `template-deps`
(`$.notes`). Template expansion happens before markdown-it parsing so any
markdown in expanded values is rendered.

---

## Motivation

Users need to compose notes that pull in data from other notes — a dashboard
that aggregates key metrics from project notes, a status page that pulls
summaries from sub-pages, or a daily log that includes yesterday's body.

Without template support, this requires manually copying content between
notes. Templates keep a single source of truth and update live.

---

## Frontmatter contract

```markdown
---
template: true
template-deps: [note:foo, other:bar]
title: My Dashboard
---

# <%= $.meta.title %>

Foo summary: <%= $.notes["note:foo"].meta.summary %>

<%~ $.notes["other:bar"].body %>
```

| Key | Type | Purpose |
|---|---|---|
| `template` | `"true"` | Gate — template expansion only runs when present |
| `template-deps` | `string[]` | List of note IDs to fetch from IndexedDB before rendering |

---

## Data object (`$`)

Eta is configured with `varName: '$'`. Everything below is accessed via `$`:

| Path | Source | Example |
|---|---|---|
| `$.meta.<key>` | Current note's parsed frontmatter | `<%= $.meta.title %>` |
| `$.config.<key>` | `getSpaConfig()` return value | `<%= $.config.timestamp_format %>` |
| `$.notes["<id>"].meta.<key>` | Dependency note's frontmatter | `<%= $.notes["note:foo"].meta.summary %>` |
| `$.notes["<id>"].body` | Dependency note's raw body | `<%~ $.notes["note:foo"].body %>` |
| `$.noteId` | Current note's ID | `<%= $.noteId %>` |

Template syntax follows standard Eta (EJS-style) with default delimiters:

| Tag | Purpose |
|---|---|
| `<%= expr %>` | Escaped output (plain text) |
| `<%~ expr %>` | Raw output (for injecting markdown) |
| `<% code %>` | Code execution (variable declarations, etc.) |

---

## No recursion

Only the current note is processed through Eta. Notes listed in
`template-deps` are fetched raw — their `content` is split into frontmatter
and body, but their own `template` flag is ignored. This keeps the model
simple and avoids cycle-detection complexity.

---

## Pipeline position

```
renderView(content, noteData)
  │
  ├─ parseFrontmatter(content)              // existing
  │
  ├─ if meta.template === "true":           // NEW
  │     expandTemplate(fm.body, fm.meta, noteData.id)
  │       ├─ read template-deps from meta (array or comma-joined string)
  │       ├─ batch dbGetNote() for each dep
  │       ├─ build data: { meta, config, notes, noteId }
  │       └─ eta.renderString(body, data) → expanded markdown
  │
  ├─ parseMk(expandedBody)                  // existing
  │
  └─ wikilinks, hydrate, search highlights  // existing
```

Expansion runs **before** markdown-it so that any markdown inside expanded
values (e.g. `$.notes["foo"].body`) is rendered as proper HTML.

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `eta` | ^4.6.0 | Template engine (EJS-compatible, 21 KB code-split) |

Import uses `eta/core` (the browser-safe bundle without `node:fs` /
`node:path`).

---

## Files created

| File | Purpose |
|---|---|
| `src/ts/template.ts` | `expandTemplate()` — gate check, dep fetch, Eta rendering |

## Files modified

| File | Change |
|---|---|
| `src/ts/markdown-view.ts` | Import `expandTemplate`; call it in `renderView()` after frontmatter parse, before `parseMk()` |
| `package.json` | Added `eta` dependency |

---

## Edge cases

- **Missing dep**: silently skipped — `$.notes["missing"]` is `undefined` in
  the template
- **`template-deps` string form**: after a META-tab roundtrip, arrays get
  flattened to comma-separated strings (e.g. `"foco"` instead of
  `["foco"]`). `expandTemplate` handles both forms.
- **Eta render failure**: caught and logged; the original body is returned
  unchanged so the note is still viewable
