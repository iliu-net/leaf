# Git-Based Storage (Alternative to JSON flat files)

## Overview

Replace the current JSON flat-file storage (`notes/{id}.json` with embedded
version maps) with plain Markdown files (`notes/{id}.md`) tracked in a git
repository.  This drops the E2EE requirement (content becomes server-visible
markdown) and delegates versioning, authorship, and history to git.

**Status:** design proposal — not yet implemented.


## Pre-requisite

Create a test suite that can be used to test storage backends.
~~sync.php should only call storage.php (no direct access to files or
database)~~ — ✅ Done (Change 026).  All three endpoints call only the
seven contract functions; no consumer accesses `$note['versions']`,
`deleted_path()`, or `changelog_append()` (except trash restore).

**All Done.**

## Motivation

- `.md` files are the natural on-disk format (the client already stores
  content as markdown with YAML frontmatter).
- Git provides versioning, diffing, authorship tracking, and backup for free.
- Standard tooling: `git clone`, `git log -p`, `git diff`, static site
  generators, CLI editing.
- Simplifies the server-side data model: no embedded version maps, no
  `date:counter:author` composite keys, no `prev` pointer chains, no
  `exclusive` flag.

---

## File Layout

```
notes/
  {id}.md          — live note (markdown + YAML frontmatter)
  {id}.meta        — write-ahead staging area (see § Staging)
  {id}.deleted     — tombstone marker: {"deleted_at": N, "deleted_by": "name"}
changelog.jsonl    — rev → commit mapping; survives git checkouts
.git/              — git repository
```

- **`.md` files** are committed to git on every logical save.
- **`.meta` files** are NOT committed — they are ephemeral staging buffers
  that defer the git commit until a trigger fires.
- **`.deleted` markers** are NOT committed — server-side operational state
  carrying `deleted_at`/`deleted_by` metadata that git doesn't natively store.
- **`changelog.jsonl`** IS committed — but always one entry behind the
  working-tree version (see § Changelog in Git).
- Unlike the normal flat file backend which has a flat namespace, this
  backend should reflect the tree link structure in the file store.
  So ":" needs to be converted to "/", and care needs to be exercised
  to prevent accessing files outside the tree.

---

## Key Simplification: Commits Are Immutable

The current JSON model allows overwriting a version slot when `exclusive=true`
(same author, same day, nobody else has seen it).  This requires the
`exclusive` flag and `storage_resolve_version()` / `storage_mark_version_seen()`.

In git, commits are immutable.  A commit SHA never changes its content.
This eliminates the overwrite problem entirely:

| Scenario | Current | Git |
|---|---|---|
| Alice saves v1 | Version key `date:1:alice`, exclusive=true | Commit `abc` |
| Bob syncs, receives v1 | exclusive→false | Bob's client now has `abc` |
| Alice saves again | exclusive=false → new key `date:2:alice` | New commit `def` on top of `abc` |
| Bob syncs again | Receives v2; v1 intact | Receives `def`; `abc` intact |

No data loss in either model.  The git model is simpler because there's no
edge case of "version key X changed its content."

**Functions deleted:** `storage_resolve_version()`, `storage_mark_version_seen()`.

---

## Write-Ahead Staging (`.meta` files)

### Problem

Without the `exclusive` flag's debouncing, every sync push by the same author
creates a new git commit.  Rapid saves produce commit spam.

### Solution: Lazy-Commit Buffer

Each note has an optional `.meta` file that stages content before committing.
The git commit is deferred until a *trigger* fires.

```
Alice writes X.md (content "v5") + X.meta {"author":"alice","date":"2026-05-29","base_commit":"abc"}
  → NO git commit yet

Alice writes X.md again (content "v6") — .meta exists, same author+date
  → overwrite X.md, .meta unchanged
  → STILL no commit

Bob syncs — server sees X.meta, author=alice ≠ bob
  → TRIGGER: commit X.md, unlink X.meta, write changelog entry
  → Bob receives committed version
```

### Commit Triggers

| Trigger | Behaviour |
|---|---|
| **Different author reads** | Flush the stage (commit + unlink `.meta`) so the reader sees the published content |
| **Date change on write** | Old `.meta` has yesterday's date → flush old stage → write new content + fresh `.meta` for today |
| **Different author writes** | Flush the original author's stage → then stage the new author's content |
| **DELETE** | Flush any staged content first → then `git rm` + commit deletion |
| **RENAME** | Flush any staged content first → then `git mv` + commit rename |
| **Bootstrap** (`syncedRevision===0`) | Flush ALL `.meta` files before building the response |
| **Maintenance** (optional TTL) | `storage_housekeeping()` — periodically flush `.meta` files older than N hours |

### `.meta` File Format

```json
{
  "author":      "alice",
  "date":        "2026-05-29",
  "base_commit": "abc123def456"
}
```

- **`author`** — who is staging this content
- **`date`** — UTC date (`Y-m-d`); date change triggers a flush
- **`base_commit`** — the last committed SHA for this file when staging began;
  becomes `prev_version` in the changelog entry on flush; `null` for new notes
  (→ CREATE on flush)

### `storage_apply_write()` with Staging

```
if .meta exists:
  if same author AND same date:
    overwrite .md, keep .meta → return null (staged)
  else:
    flush existing stage (commit + changelog + unlink .meta)
    fall through

write .md
write new .meta {author, date, base_commit: last_committed_sha_or_null}
return null (staged — no new revision yet)
```

### Read-Side Trigger

`storage_get_note_full($id, $viewer)` is the consumer-facing read.
If a `.meta` exists and `viewer !== meta.author`, the stage is flushed
before returning the content.  Consumers are unaware — they just pass
`$author` and get back normalized data.

```php
function storage_get_note_full(string $id, string $viewer): ?array {
    $note = storage_get_note($id);   // internal: reads .md + git metadata
    if (!$note) return null;

    // Staging flush: if a .meta exists and viewer ≠ author, commit it first
    $metapath = meta_path($id);
    if ($viewer !== '' && file_exists($metapath)) {
        $meta = json_decode(file_get_contents($metapath), true);
        if (($meta['author'] ?? '') !== $viewer) {
            storage_flush_stage($id);
            $note = storage_get_note($id);   // re-read after commit
        }
    }

    // ... normalize into flat shape (content, version, prev, ...) ...
}
```

---

## Changelog Format

### Before (current)

```json
{"rev":12,"file":"my-note","type":"UPDATE","ts":1748200000,
 "version":"2026-05-29:1:alice","prev_version":"2026-05-28:2:alice"}
```

### After (proposed)

```json
{"rev":12,"version":"abc123def456","file":"my-note","type":"UPDATE","ts":1748200000,
 "prev_version":"789fedcba321"}
```

- `version` / `prev_version` keep the same field names — only the
  values change (git SHAs instead of `date:counter:author` composite
  keys).  `changelog_entry_to_dexie_change()` in sync.php reads these
  field names, so preserving them avoids consumer churn.
- DELETE entries keep `deleted_by`
- RENAME entries keep `renamed_to`, `renamed_by`
- Monotonic `rev` numbers unchanged — managed by `changelog_next_rev()` / `changelog_append()`

---

## Changelog in Git

The changelog IS committed to git, but always **one entry behind** the
working-tree version.  This resolves the chicken-and-egg problem: a
changelog entry needs the commit SHA, but the commit SHA is determined
by the commit that would include the changelog file.

### The Trailing-Commit Model

Each commit bundles **the current operation's file changes** together with
**the changelog entry from the previous operation**:

```
Op 1 (Alice writes X):
  write notes/X.md
  git add notes/X.md
  git commit -m "UPDATE X"                                          → SHA abc
  append changelog: {"rev":12, "version":"abc", "file":"X", ...}
  changelog.jsonl is DIRTY (rev:12 exists on disk, not in any commit)

Op 2 (Bob writes Y):
  write notes/Y.md
  git add notes/Y.md changelog.jsonl    ← picks up rev:12 from op 1
  git commit -m "UPDATE Y"                                          → SHA def
    This commit contains: notes/Y.md + changelog entry for rev:12
  append changelog: {"rev":13, "version":"def", "file":"Y", ...}
  changelog.jsonl is DIRTY again (rev:13 uncommitted)
```

Git history:
```
def   UPDATE Y          (notes/Y.md, changelog.jsonl updated → rev:12)
abc   UPDATE X          (notes/X.md)
```

The **working-tree** `changelog.jsonl` has all entries including rev:13.
The **git-tracked** changelog (at `def`) has entries up to rev:12 — it trails
by exactly one entry.

### Why This Works

1. **The app always reads `changelog.jsonl` from the filesystem**, never from
   `git show HEAD:changelog.jsonl`.  The working tree has the full truth.
2. **On `git clone`:** the working tree is checked out at HEAD → `changelog.jsonl`
   contains all entries visible at HEAD plus the uncommitted trailing entry
   on disk.  No reconstruction needed.
3. **On disaster recovery** (working tree destroyed, reclone from bare repo):
   the last entry is missing.  Reconstruct it from `git log -1`:

   ```bash
   git log -1 --format='%H %at %an' --name-only --diff-filter=AM -- notes/
   # → SHA, timestamp, author, files changed
   # Build the missing entry: {"rev":N, "version":<SHA>, "file":<file>, ...}
   ```

4. **Full changelog reconstruction** is always possible from `git log`:
   - CREATE/UPDATE: `git log --format='%H %at %an' --name-only --diff-filter=AM -- notes/`
   - DELETE: `git log --diff-filter=D --format='%H %at %an' -- notes/` (plus
     `deleted_by` recovered from the `.deleted` marker or commit message)
   - RENAME: `git log --find-renames --format='%H %at %an' -- notes/`

### Stale Trailing Entry

If no writes happen for a while, the last changelog entry stays uncommitted
indefinitely.  This is harmless — it exists on disk and is used by
`changelog_since()`.  The next write (of any note) will commit it.

The only risk: if the server crashes after appending to `changelog.jsonl` but
before the next write commits it, the entry survives on disk (durable).  There
is no "gap" — the working tree always has the full log.

### Commit Message Convention

To make reconstruction easier, commit messages should include the operation
type and note ID:

```
UPDATE my-note
DELETE old-note
CREATE new-note
RENAME old-id → new-id
```

This allows `git log` reconstruction to determine the `type` and `file`
fields without guessing from `--diff-filter`.

---

## Revised `storage.php` Functions

### Path Helpers

```php
function note_path(string $id): string    { return NOTES_DIR . $id . '.md'; }
function meta_path(string $id): string    { return NOTES_DIR . $id . '.meta'; }
function deleted_path(string $id): string { return NOTES_DIR . $id . '.deleted'; }
```

### Consumer-facing contract (unchanged signatures)

These 7 functions are the storage contract from Change 026.  Their
signatures are identical across flat-file and git backends — only the
internals differ.

| Function | Git backend implementation |
|---|---|
| `storage_get_note_full($id, $viewer)` | Reads `.md` file; flushes `.meta` if `viewer ≠ meta.author`; queries git for metadata. Returns the same flat shape. |
| `storage_put_note_logged($id, $content, $author, $client_version)` | See staging logic below. Returns `[$sha, false]` on commit, `null` on stage. |
| `storage_delete_note_logged($id, $author)` | Flushes stage → writes `.deleted` → `git rm` → commit → changelog. Returns `bool`. |
| `storage_rename_note_logged($old, $new, $author)` | Flushes stage → `git mv` → commit → changelog. Returns `bool`. |
| `storage_get_version_list($id)` | `git log --format='%H %at %an' -- notes/{id}.md` |
| `storage_get_version_content($id, $vkey)` | `git show {sha}:notes/{id}.md` |
| `storage_get_tombstone($id)` | Recovers content from last commit before deletion via `git show`. |

### Internal primitives (called only by contract functions)

| Function | Change |
|---|---|
| `storage_note_exists()` | Unchanged — checks `.deleted` absence + `.md` presence |
| `storage_note_deleted()` | Unchanged — checks `.deleted` marker |
| `storage_get_note($id)` | Internal only. Reads `.md` + git metadata. Returns internal representation (no `versions` key). |
| `storage_put_note($id, $data)` | Writes `.md` directly (used by flush, not staging path) |
| `storage_apply_write($id, $content, $author)` | See staging logic below. Returns SHA on commit, `null` on stage. |
| `storage_delete_note($id, $deleted_by)` | Writes `.deleted` marker → `git rm` → commit |
| `storage_revive_note($id)` | `git show` to recover → writes `.md` → removes `.deleted` → commit CREATE |
| `storage_rename_note($old, $new)` | Filesystem `rename()` → git commit |
| `storage_list_notes()` | Globs `.md`; batches git metadata query |
| `storage_list_deleted_notes()` | Globs `.deleted` markers |
| `storage_purge_deleted_notes()` | Unlinks `.deleted` markers older than TTL |
| `storage_hard_delete_note()` | Unlinks `.deleted` marker |
| `storage_flush_stage($id)` | **New.** Commits staged `.md` + unlinks `.meta` + writes changelog entry. Returns SHA. |
| `storage_flush_all_stages()` | **New.** Flushes every `.meta` file. Called at bootstrap. |

### Deleted Functions

- `storage_resolve_version()` — no overwrite/append decision needed
- `storage_mark_version_seen()` — commits are immutable, nothing to flip
- `created_by` lazy-migration code — git log provides this on every read

### Changed Constants

- `storage_e2ee_support()` — returns `false` in git mode.  Not a
  technical limitation (opaque blobs can be stored in `.md` files and
  versioned by git just fine), but E2EE defeats the purpose of the git
  backend: `git diff` shows ciphertext, static site generators can't
  render content, CLI editing is impossible.  If you need E2EE, use the
  flat-file backend instead.

---

## Git Operations

### `git_commit_file($id, $content, $author, $message)`

Commits the note file AND any dirty changelog entries from the previous write.
Returns the new commit SHA.

```php
function git_commit_file(string $id, string $content, string $author,
                         string $message): string {
    $lock = fopen(GIT_LOCK_FILE, 'w');
    flock($lock, LOCK_EX);   // serialize ALL git operations

    file_put_contents(note_path($id), $content);

    // Stage the note file
    exec("git add " . escapeshellarg("notes/{$id}.md"), $output, $rc);

    // Stage changelog if it has uncommitted entries from the previous op
    // (git diff --quiet returns 1 if there are unstaged changes)
    exec('git diff --quiet ' . escapeshellarg(CHANGELOG_FILE), $output, $diff_rc);
    if ($diff_rc !== 0) {
        exec("git add " . escapeshellarg(CHANGELOG_FILE), $output, $rc);
    }

    exec("git commit --author=" .
         escapeshellarg("{$author} <{$author}@leaf.local>") .
         " -m " . escapeshellarg($message), $output, $rc);

    $sha = trim(shell_exec('git rev-parse HEAD'));
    flock($lock, LOCK_UN);
    fclose($lock);
    return $sha;
}
```

Key detail: `changelog.jsonl` is staged together with the note file in a
single commit.  The changelog entries it picks up are from the *previous*
operation.  After this commit returns, the caller appends the new changelog
entry (for this operation), leaving `changelog.jsonl` dirty again.

### `storage_apply_write()` Full Flow

Called internally by `storage_put_note_logged()`.  Returns the commit
SHA on flush, or `null` when content is staged (no commit created).

```php
function storage_apply_write(string $id, string $content, string $author): ?string {
    $is_new = !file_exists(note_path($id));
    $prev_sha = $is_new ? null : git_log_last_sha($id);

    // 1. Handle staging (see § Staging)
    $metapath = meta_path($id);
    if (file_exists($metapath)) {
        $meta = json_decode(file_get_contents($metapath), true);
        $today = gmdate('Y-m-d');
        if (($meta['author'] ?? '') === $author && ($meta['date'] ?? '') === $today) {
            // Same author, same day → just update the staged content
            file_put_contents(note_path($id), $content);
            return null;  // staged, no new commit
        }
        // Different author or new day → flush the existing stage first
        storage_flush_stage($id);
    }

    // 2. Commit (includes changelog entries from previous operations)
    $type = $is_new ? 'CREATE' : 'UPDATE';
    $message = "{$type} {$id}";
    $sha = git_commit_file($id, $content, $author, $message);

    // 3. Append changelog entry (dirty — will be committed by the next op)
    changelog_append([
        'rev'          => changelog_next_rev(),
        'version'      => $sha,
        'file'         => $id,
        'type'         => $type,
        'ts'           => time(),
        'prev_version' => $prev_sha,
    ]);

    return $sha;
}
```

`storage_put_note_logged()` wraps this: returns `[$sha, false]` on
commit, `null` on stage.  DELETE and RENAME logged functions follow the
same structure: commit files + dirty changelog together, then append
their own changelog entry.

### `git_file_info($id)`

```php
// Creation: first commit that introduced the file
exec("git log --diff-filter=A --format='%H %at %an' -- " .
     escapeshellarg("notes/{$id}.md") . " | tail -1", $output);

// Latest: most recent commit touching the file
exec("git log -1 --format='%H %at %an' -- " .
     escapeshellarg("notes/{$id}.md"), $output);
```

### Concurrency

All git mutating operations MUST be serialized with `flock` on a dedicated
lock file (`DATA_ROOT . '.git-lock'`).  Reads (`git log`, `git show`) do not
need the lock.

The `changelog.jsonl` append also happens inside the git lock (it's called
right after `git_commit_file()` returns, which holds the lock).  The existing
`flock` inside `changelog_append()` provides defense-in-depth but the git
lock ensures changelog append and git commit don't interleave.

---

## Sync Protocol Changes

### Client → Server (push)

Only the values change — structure is identical:

| Field | Before | After |
|---|---|---|
| `obj.version` | `"2026-05-29:1:alice"` | `"abc123def456..."` |
| `obj.content` | opaque blob | markdown string |

### Server → Client (pull response)

| Field | Before | After |
|---|---|---|
| `obj.version` | `"2026-05-29:1:alice"` | `"abc123def456..."` |
| `obj.prev_version` | `"2026-05-28:2:alice"` | `"789fedcba321..."` |
| `obj.content` | opaque blob | markdown string |

### Bootstrap (`syncedRevision === 0`)

1. `storage_flush_all_stages()` — flush ALL `.meta` files (orphaned
   stages from crashed writers or stale deferred commits)
2. `storage_list_notes()` + `storage_get_note_full()` — read all `.md`
   files, batch query git for per-file metadata
3. Build CREATE changes as before (same code path as flat-file backend)

### Conflict Detection

Conflict detection lives inside `storage_put_note_logged()` (behind the
contract — consumers don't see it).  Compares the client's version SHA
against the latest git commit touching that file.  If they differ, logs a
conflict but still applies the change (same last-write-wins semantics as
the flat-file backend).

---

## History Endpoint

- `action=list` → `git log --format='%H %at %an' -- notes/{id}.md`
- `action=get` → `git show {sha}:notes/{id}.md` for each requested SHA

Response format: same structure; `key` is now a SHA instead of `date:counter:author`.

---

## Trash Endpoint

- **Preview:** recover content from the last commit before deletion
  (`git show {sha}:notes/{id}.md`)
- **Restore:** recover content from git → write `.md` → remove `.deleted` →
  commit → changelog entry
- **Purge/hard-delete:** unlink `.deleted` marker; git history is never
  rewritten (file remains recoverable via git log)
- **Empty:** unlink all `.deleted` markers

---

## Front-End Impact

**Minimal changes.** The `NoteRecord.current` field is already a string.
It stores `"2026-05-29:1:alice"` today; it would store `"abc123def"` after.
No IndexedDB schema migration needed.

| Component | Change |
|---|---|
| `db.ts` (Dexie schema) | None — `current` is already `string` |
| `sync.ts` (applyServerNoteChange) | None — version/prev_version passed through as strings |
| `sync.ts` (push) | None — `entry.version` sent as-is |
| `frontmatter.ts` | None — already parses markdown with YAML frontmatter |
| `history.ts` | May need to handle SHA display (truncated) vs. old composite keys |

The one subtlety: when a note is staged, the server returns `currentRevision`
unchanged and the client's `current` field doesn't advance.  The client
already handles this — unsynced notes have `current: "local"`, and staged
notes are effectively in the same bucket (server has the content, but it's
not yet a committed version).

---

## Tradeoffs

### Gains

- `.md` files on disk — readable, editable outside the app, usable with
  static site generators
- Git history — `git log`, `git diff`, `git blame` for free
- No embedded version map in the note file — content is pure markdown
- Immutable commits eliminate `exclusive` flag and overwrite edge cases
- Standard tooling — `git clone` for backup, `git log -p` for audit
- Changelog committed to git — `git clone` carries the full audit log
  (trailing one entry behind; reconstructable from `git log -1`)
- `git log` can fully reconstruct the changelog if `changelog.jsonl` is
  ever lost or corrupted

### Costs

- E2EE dropped (by design — content must be server-visible for git diffs to
  be meaningful)
- `storage.php` adds ~200 lines of git-wrapper code (offset by removing ~150
  lines of version-management code)
- All git-mutating operations must be serialized behind a `flock`
- Staging logic lives entirely inside `storage.php` — `sync.php` is
  unaffected (it just passes `$author` as `$viewer` and destructures
  the `$dirty` boolean without knowing what they mean for git)
- `git log` queries add latency to `storage_get_note()` and
  `storage_list_notes()` (acceptable for low transaction volume)
- Git history grows unboundedly; may require periodic shallow-cloning or
  history truncation for very old deployments

### Unchanged

- Sync protocol structure (poll pattern, revision cursor, change types)
- Monotonic `rev` numbers in changelog
- Client-side IndexedDB schema
- Authentication, CORS, routing
- Audit logging

---

## Open Questions

1. **One commit per change vs. one commit per sync push?**
   Per-change gives cleaner per-file history.  Start with per-change; batch
   later if commit count becomes an issue.

2. **Should `.deleted` markers be committed to git?**
   Recommendation: no.  They carry operational metadata (`deleted_at`,
   `deleted_by`) that git doesn't natively store.  Committing them would
   create noisy history for every delete/restore cycle.

3. **Git author identity format.**
   Current proposal: `username <username@leaf.local>`.  For multi-server
   deployments, use real email addresses (configurable).

4. **Git history growth over years.**
   Mitigations: periodic shallow-clone for new deployments; changelog serves
   as the fast path for sync regardless of history size.

5. **Staging TTL.**
   Should `.meta` files auto-flush after a timeout (e.g. 24 hours)?
   `storage_housekeeping()` is the designated hook (called daily from
   sync.php's purge block).  Bootstrap already handles stale stages on
   `syncedRevision===0`, so they don't accumulate across restarts
   regardless.

6. **Concurrent git index corruption.**
   Solved by `flock`-serialized writes.  Reads are lock-free and read
   consistent file contents.  If a read happens mid-write (before commit),
   it sees the new `.md` content (which is fine — it's the latest content,
   just not yet in a git commit).

7. **Rapid same-author saves creating no commits until a trigger.**
   This is the design.  If Alice writes 50 times and nobody else reads, no
   commits are created.  Is this acceptable for audit purposes?  The
   changelog doesn't see the intermediate states.  If audit of all saves is
   required, always-commit (no staging) is the alternative — accept the
   commit spam.
