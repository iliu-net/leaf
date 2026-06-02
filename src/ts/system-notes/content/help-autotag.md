---
title: Auto-tagging
---


Leaf can automatically tag your notes based on words found in the content.

# How it works

Create a special note called `_tagcloud` that maps words to tags. Each
custom frontmatter field is a **tag name**; its value is a bracket-array of
**trigger words**.

```
---
title: Tag Cloud
finance: [invoice, receipt, budget, tax]
work: [meeting, presentation, deadline]
development: [bug, feature, refactor, deploy]
---
```

Whenever you save a note, Leaf scans the body text (below the frontmatter)
against these rules. Any matching tag gets written to the `auto-tags`
frontmatter key.

# Matching rules

- **Case-insensitive** — `Invoice` and `invoice` both match
- **Word boundary** — `meet` does **not** match `meeting` (whole-word only)
- **Body only** — frontmatter values are not scanned, so your metadata
  doesn't accidentally trigger tags

# Merging with manual tags

Your `user-tags` (edited in the Meta tab) are merged with `auto-tags` for
display. You can control the merge:

| Add this to user-tags | Effect |
|---|---|
| `important` | Adds `important` to the final tag set |
| `!work` | Removes `work` from auto-tags (silent if absent) |
| `!*` | Discards **all** auto-tags — only your manual tags appear |

Negated tags stay in `user-tags` but never appear in the final display.

# When does scanning happen?

Auto-tagging runs **only when you save a note locally**. Notes received
from the server during sync are not re-scanned — the remote author already
tagged them.

If you edit `_tagcloud`, each note picks up the new rules the next time
it is saved. There is no bulk rescan.

# Disabling auto-tagging

- **Per note:** add `!*` to `user-tags`. On the next save, all auto-tags
  are removed from that note and scanning is skipped.
- **Globally:** delete the `_tagcloud` note or clear its custom fields.
  Auto-tags will be cleaned up on each note's next save.
