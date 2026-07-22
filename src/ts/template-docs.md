---
title: Template Expansion
---

# Template Expansion

Templates let you build notes that pull in data from other notes — dashboards,
status pages, daily logs that include yesterday's body, and more.

## Enabling

Add `template: true` to your note's frontmatter and list the notes you want
to reference in `template-deps`:

```markdown
---
template: true
template-deps: [projects:alpha, meetings:weekly]
title: My Dashboard
---

# <%= $.meta.title %>


```

Only notes with `template: true` trigger expansion — regular notes are
unaffected.

## Syntax

Templates use standard Eta / EJS syntax with `<% %>` delimiters:

| Tag | Purpose | Example |
|---|---|---|
| `<%= expr %>` | Escaped output | `<%= $.meta.title %>` |
| `<%~ expr %>` | Raw output (markdown) | `<%~ $.notes["foo"].body %>` |
| `<% code %>` | Code block | `<% const x = "hello" %>` |

## Available data

The data object is accessed with `$`:

| Path | Source |
|---|---|
| `$.meta.title` | Current note's title |
| `$.meta.summary` | Current note's summary |
| `$.meta.<key>` | Any frontmatter field on this note |
| `$.config.timestamp_format` | Server config value |
| `$.notes["note-id"].meta.title` | Another note's title |
| `$.notes["note-id"].meta.<key>` | Any frontmatter field from another note |
| `$.notes["note-id"].body` | Another note's raw body (use `<%~ %>` |
| `$.noteId` | Current note's ID |

## Examples

### Simple dashboard

```markdown
---
template: true
template-deps: [projects:alpha, projects:beta]
title: Project Status
---

# <%= $.meta.title %>

## Alpha

**Status:** <%= $.notes["projects:alpha"].meta.status %>

## Beta

**Status:** <%= $.notes["projects:beta"].meta.status %>
```

### Include another note's body

```markdown
---
template: true
template-deps: [daily:2026-05-30]
title: Daily Log — 2026-05-31
---

# <%= $.meta.title %>

## Yesterday

<%~ $.notes["daily:2026-05-30"].body %>
```

### Inline variables with `<% %>`

```markdown
---
template: true
template-deps: [metrics:q2]
title: Q2 Report
---

<% const rev = $.notes["metrics:q2"].meta.revenue %>

Revenue target: **$<%= rev %>**

<% if (Number(rev) > 100000) { %>
🚀 Above target!
<% } %>
```

## Notes

- Template expansion runs **before** markdown rendering — any markdown in
  expanded values will be rendered.
- Only one level deep — notes listed in `template-deps` are fetched raw.
  Their own `template` flag is ignored.
- Missing deps are silently skipped.
- Use `<%~ %>` for including markdown (other notes' bodies), `<%= %>` for
  plain text values (titles, summaries, config).
