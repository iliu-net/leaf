---
title: WikiLinks Plugin
---

# WikiLinks

The wikilinks plugin adds `[[page]]` style links between notes.

## Syntax

| Pattern | Result |
|---------|--------|
| `[[note-id]]` | Link to `note-id`, displays as `note-id` |
| `[[note-id\|Label]]` | Link to `note-id`, displays as **Label** |
| `[[note-id\|]]` | Link to `note-id`, displays the target note's **title** |

## Notes

- Wikilinks work across all notes in the workspace
- Links to system notes (`[[@about:help:shortcuts]]`) are supported
- Clicking a wikilink navigates to the target note
- Missing targets are styled with a red dashed underline
- Targets are resolved at render time — no need to worry about note creation order

## Example

```markdown
See [[projects:alpha]] for the initial spec and
[[@about:help:markdown|the markdown guide]] for syntax help.
```
