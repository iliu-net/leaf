---
title: Task Lists Plugin
---

# Task Lists

The task lists plugin adds support for GitHub-flavoured task lists —
interactive-looking checkboxes for `- [ ]` and `- [x]` items.

## Usage

Create a task list using `- [ ]` for unchecked items and `- [x]` for
checked ones:

```markdown
- [x] Install Leaf
- [x] Configure auth
- [ ] Write first note
- [ ] Set up sync
```

This renders as:

- [x] Install Leaf
- [x] Configure auth
- [ ] Write first note
- [ ] Set up sync

Task lists work inside both unordered (`-`) and ordered (`1.`) lists.
Nesting is supported — indent sub-items as usual:

```markdown
1. [x] Sprint planning
   - [ ] Define scope
   - [ ] Estimate tasks
2. [ ] Code review
```

## Configuration

The plugin accepts these options via the tuple config form
(see `markdown.plugins` in your server config):

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | When `true`, checkboxes are interactive (no `disabled` attribute). When `false`, they are read-only. |
| `label` | boolean | `false` | When `true`, wraps each checkbox + label text in a `<label>`, giving larger click targets. |
| `labelAfter` | boolean | `false` | When `true`, uses `<label for="...">` after the checkbox instead of wrapping. Requires `label: true`. |

### Server config examples

**Default (read-only checkboxes):**

```php
$spa_config['markdown']['plugins'] = [
    'tasklists',
];
```

**Interactive checkboxes with label wrapping:**

```php
$spa_config['markdown']['plugins'] = [
    ['tasklists', ['enabled' => true, 'label' => true]],
];
```

**Interactive checkboxes with label-after (better accessibility):**

```php
$spa_config['markdown']['plugins'] = [
    ['tasklists', ['enabled' => true, 'label' => true, 'labelAfter' => true]],
];
```

If no tuple options are provided (plain `'tasklists'` string), defaults
apply: checkboxes are disabled (read-only), no label wrapping.

## Caveats

### Read-only by default

By default checkboxes are rendered with `disabled=""`, meaning they
cannot be toggled by clicking.  This is intentional — Leaf is a note
editor, not a task manager.  The checkboxes are a **visual indicator**
of task status in the rendered view.

If you want interactive checkboxes (e.g. for tracking daily standup
notes), set `'enabled' => true` in the config.  Note however:

- **Checkbox state is not persisted.** Toggling a checkbox in the
  View tab does not modify the underlying markdown source (`[ ]` ↔
  `[x]`).  Refreshing the view resets all checkboxes to their
  markdown-source state.

- **No event listeners are attached.**  Even with `enabled: true`,
  the plugin only removes the `disabled` attribute.  Leaf does not
  ship JavaScript to intercept checkbox clicks and update the source
  or sync state anywhere.

### X vs x

Both `[x]` and `[X]` are recognised as checked.  Mixed case in a
single document works fine.

### Whitespace matters

The plugin expects exactly one space after the brackets:

```
- [ ] correct
- [x] correct
- []  not recognised (missing space)
- [ x] not recognised (space before x)
- [ x ] not recognised (extra spaces)
```

### Nested task lists

The outer list container (`<ul>` or `<ol>`) receives the class
`contains-task-list`.  Individual items receive `task-list-item`
(or `task-list-item enabled` when interactive).  These classes can
be targeted in custom CSS themes.

### Markdown-in-task-text is preserved

The text portion of a task item supports inline markdown (bold,
italic, code, links, etc.) as normal:

```markdown
- [ ] Review **critical** `config.php` changes
- [x] Update [[api-protocol]] documentation
```
