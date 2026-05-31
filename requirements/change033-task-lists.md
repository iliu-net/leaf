# Change 033 — Task Lists plugin (markdown-it-task-lists)

## Summary

Add the `markdown-it-task-lists` third-party plugin to render
GitHub-style task lists (`- [ ]` / `- [x]`) as checkboxes in the
markdown View tab.  The plugin is lazy-loaded and code-split away
from the main bundle.

## Motivation

Users frequently write checklists in their notes — sprint plans,
packing lists, reading lists, meeting action items.  Displaying these
as styled checkboxes (rather than raw `[ ]` / `[x]` brackets) makes
them scannable and visually distinct.  GitHub and many other markdown
renderers support this syntax natively; Leaf should too.

## Usage

```markdown
- [x] Install Leaf
- [x] Configure auth
- [ ] Write first note
- [ ] Set up sync
```

Renders as styled checkboxes — checked items show a ticked box,
unchecked items an empty one.

## Architecture

| Layer | Mechanism |
|---|---|
| Plugin | `markdown-it-task-lists` — a `md.core.ruler` hook that rewrites list-item inline tokens, injecting `<input type="checkbox">` HTML |
| Wrapper | `src/ts/extensions/task-lists.ts` — thin adapter: default-export `(md, options?) => void` |
| Registry | `_pluginRegistry.tasklists` — lazy `import()` entry in `markdown.ts` |
| Docs | `src/ts/extensions/task-lists-docs.md` — registered as system note `@help:markdown:task-lists` |
| Styles | `spa/css/layout.css` — `.task-list-item`, `.task-list-item-checkbox`, `.contains-task-list` |

The plugin operates on the token stream before HTML generation.  It
detects list items whose first inline content matches `[ ] `, `[x] `,
or `[X] `, then prepends an `html_inline` token containing the
checkbox `<input>`.

## Files changed

| File | Change |
|---|---|
| `package.json` | Added `markdown-it-task-lists` dependency (was already present from prior pnpm install) |
| `src/ts/extensions/task-lists.ts` | New plugin wrapper + system-note registration |
| `src/ts/extensions/task-lists-docs.md` | In-app help documentation |
| `src/ts/markdown.ts` | Added `tasklists` to `_pluginRegistry` |
| `spa/css/layout.css` | Added `.task-list-item`, `.task-list-item-checkbox`, `.contains-task-list` structural styles |

## Configuration

The plugin is activated by adding `"tasklists"` to `markdown.plugins`
in the server config.  Options are passed via tuple syntax.

### Default (read-only checkboxes)

```php
$spa_config['markdown']['plugins'] = [
    'tasklists',
];
```

Produces: `<input class="task-list-item-checkbox" disabled="" type="checkbox">`

### Interactive checkboxes

```php
$spa_config['markdown']['plugins'] = [
    ['tasklists', ['enabled' => true]],
];
```

Removes the `disabled` attribute so checkboxes respond to clicks.

### With label wrapping

```php
$spa_config['markdown']['plugins'] = [
    ['tasklists', ['enabled' => true, 'label' => true]],
];
```

Wraps checkbox + text in `<label>` for larger click targets.

### With label-after (better a11y)

```php
$spa_config['markdown']['plugins'] = [
    ['tasklists', ['enabled' => true, 'label' => true, 'labelAfter' => true]],
];
```

Uses `<label for="...">` after the checkbox.

## Options reference

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | If `true`, checkboxes have no `disabled` attribute |
| `label` | boolean | `false` | If `true`, wraps each item in `<label>` |
| `labelAfter` | boolean | `false` | If `true`, uses `<label for>` after the checkbox. Requires `label: true` |

## Caveats

1. **Checkbox state is not persisted.**  Toggling a checkbox in the
   View tab does not modify the underlying markdown source.  The `[ ]`
   ↔ `[x]` flip only persists if the user edits the source manually.

2. **No click handlers.**  Even with `enabled: true`, no JavaScript
   intercepts checkbox clicks to update anything.  The plugin only
   controls the `disabled` HTML attribute.

3. **Whitespace is strict.**  Only `- [ ] ` and `- [x] ` (exactly one
   space between brackets, one trailing space) are recognised.
   `- []`, `- [ x]`, and `- [ x ]` are not matched.

4. **Both `[x]` and `[X]` are accepted** as checked.  Case doesn't
   matter.

5. **Works with ordered lists** (`1. [ ]`) as well as unordered.

6. **View-only.**  The Edit tab shows raw `[ ]` / `[x]` brackets since
   it is a plain `<textarea>`.  The checkboxes appear only in the View
   tab after markdown rendering.
