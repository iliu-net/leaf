# Leaf Python Client — Implementation Plan

## Overview

A Python package (`leaf`) providing a Pythonic client for the Leaf notes API,
plus a CLI for bulk import/export and note management.

The server API is documented in `requirements/baseline.md` §5.

### URL construction

The ``base_url`` passed to ``LeafClient`` must include the API path prefix.
Endpoints are constructed as ``{base_url}/{endpoint}``:

- ``base_url = 'https://example.com/api/index.php'`` — explicit ``index.php``
- ``base_url = 'https://example.com/api'`` — clean URLs (no ``index.php``)

### Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth?action=login` | POST | no | Login → `{ok, token, username, expires}` + httpOnly refresh cookie |
| `/api/auth?action=refresh` | POST | cookie | Silent JWT refresh, rotates refresh token |
| `/api/auth?action=logout` | POST | cookie | Invalidate refresh token, clear cookie |
| `/api/sync` | POST | JWT | Push local changes + pull server changes (revision-based) |
| `/api/trash` | POST | JWT | `list` / `restore` / `preview` / `purge` / `empty` |
| `/api/history` | POST | JWT | Version chain: `list` versions, `get` version contents |
| `/api/spa-config` | GET | no | Public SPA configuration |

---

## File layout

```
setup.py                         # setuptools, console_scripts entry point: leaf
leaf/                            # package — ships in wheel
  ├── __init__.py                # public exports
  ├── client.py                  # LeafClient class — auth lifecycle, HTTP, all endpoints
  ├── cli.py                     # argparse subcommands
  ├── models.py                  # dataclasses: NoteInfo, Note, Change, SyncState, …
  ├── sync.py                    # change-type constants + utility functions
  └── config.py                  # YAML config file + env var + CLI arg resolution

tests/                           # NOT shipped in wheel
  ├── __init__.py                # suite loader (doctest suites + integration)
  └── test_client.py             # integration tests against php -S
```

---

## Style conventions

- 2-space indent
- Single quotes for strings (`'hello'`)
- Triple single quotes for docstrings (`'''docstring'''`)
- Docstring format: Sphinx directives (`:param:`, `:returns:`, `:rtype:`) with MyST markdown
- Full type annotations using `X | None` syntax (targeting Python ≥3.10)
- Doctests for all pure functions (no network I/O)
- `unittest` for integration tests (zero extra test dependencies)

---

## Dependencies

`setup.py` declares:

```python
install_requires=['requests', 'pyyaml']
python_requires='>=3.10'
```

Everything else is stdlib: `argparse`, `dataclasses`, `doctest`, `unittest`,
`json`, `fnmatch`, `getpass`, `pathlib`, `typing`, `os`, `sys`.

---

## Module: `leaf/config.py`

Configuration resolution, priority (highest first):

1. CLI arguments (`--url`, `--username`, `--password`)
2. Environment variables (`LEAF_URL`, `LEAF_USERNAME`, `LEAF_PASSWORD`)
3. YAML config file — first found of:
   - `./leaf.yaml` (current directory — per-project config)
   - `~/.config/leaf/config.yaml`

YAML file format:

```yaml
url: https://example.com
username: alice
password: hunter2
```

Exported functions:

### `load_config(cli_args=None) -> dict[str, str]`

Resolve configuration from all sources, return `{'url', 'username', 'password'}` dict.
Called by both `cli.py` and programmatic users.

### `save_config(data: dict) -> None`

Write a config dict to `~/.config/leaf/config.yaml` (creates directory if needed).

---

## Module: `leaf/models.py`

Pure data classes. All are `@dataclass` with full type annotations. No methods that
do I/O — serialization helpers only.

### `NoteInfo`

Metadata for a live note (from sync pull or list).

```python
@dataclass
class NoteInfo:
  id: str                           # note identifier
  created_at: int | None = None     # unix timestamp
  updated_at: int | None = None     # unix timestamp
  version: str | None = None        # current version key
  created_by: str = ''
  author: str = ''                  # last author
```

### `TrashEntry`

Metadata for a soft-deleted note (from trash list).

```python
@dataclass
class TrashEntry:
  id: str
  deleted_at: int | None = None
```

### `Note`

Full note including content.

```python
@dataclass
class Note:
  id: str
  content: str                      # opaque — server never reads
  created_at: int | None = None
  created_by: str = ''
  version: str | None = None        # current version key
```

### `VersionEntry`

A single version in a note's history chain.

```python
@dataclass
class VersionEntry:
  key: str                          # version key, e.g. "2026-05-26:1:alice"
  author: str
  saved_at: int                     # unix timestamp
  prev: str | None = None           # previous version key
```

### `Change`

A pending or received change in the sync protocol. Mirrors the wire format.

```python
@dataclass
class Change:
  type: int                         # 1=CREATE, 2=UPDATE, 3=DELETE, 4=RENAME
  key: str                          # note identifier
  obj: dict | None                  # {"id","content","version","prev_version","author","created_by"}
                                    # or {"renamed_to","version"} for RENAME
                                    # or None for DELETE
  def to_dict(self) -> dict: ...
  @classmethod
  def from_dict(cls, data: dict) -> 'Change': ...
```

### `SyncState`

Serializable revision tracker for stateful sync. Caller persists via `to_json` / `from_json`.

```python
@dataclass
class SyncState:
  revision: int = 0
  def to_json(self) -> str: ...
  @classmethod
  def from_json(cls, data: str | dict) -> 'SyncState': ...
```

---

## Module: `leaf/sync.py`

Constants, wire-format helpers, and pure utility functions.

### Constants

```python
CREATE = 1
UPDATE = 2
DELETE = 3
RENAME = 4
```

### `collapse_queue(queue: list[Change], new_change: Change) -> list[Change]`

Return a new list with `new_change` collapsed in. Mimics the SPA's `queueChange`
logic:

- If `new_change` is CREATE/UPDATE/RENAME on key X:
  - Remove any pending CREATE/UPDATE/RENAME for X
  - Append `new_change`
- If `new_change` is DELETE on key X:
  - Remove any pending CREATE for X (no point creating just to delete)
  - Append DELETE

Does not mutate the input list.

Includes doctests.

### `deduplicate_changes(changes: list[Change]) -> list[Change]`

Given a list of changes (e.g. from a sync pull response), return a new list
with only the **last** state per key. Used when processing pull responses that
may contain multiple entries for the same note.

Does not mutate the input list.

Includes doctests.

### `parse_sync_response(raw: dict) -> tuple[int, list[Change]]`

Parse a sync.php JSON response body into `(currentRevision, changes)`.

### `build_sync_body(revision: int, changes: list[Change], partial: bool = False) -> dict`

Build the request body for POST /sync.

### `build_change(type: int, key: str, *,
  content: str | None = None,
  version: str | None = None,
  renamed_to: str | None = None,
) -> Change`

Convenience constructor for building a Change with the correct `obj` shape.

---

## Module: `leaf/client.py`

The main API client. Manages a `requests.Session`, JWT access token (in memory),
and the httpOnly refresh cookie (handled by the session's cookie jar).

### Exceptions

```python
class LeafError(Exception): ...               # base
class LeafAuthError(LeafError): ...           # 401 — token expired or bad credentials
class LeafNotFoundError(LeafError): ...       # 404 — note/tombstone not found
class LeafAPIError(LeafError): ...            # 400, 405, 500, etc.
```

### `LeafClient`

```python
class LeafClient:
  '''
  Pythonic client for the Leaf notes API.

  Handles the full auth lifecycle: login, automatic token refresh on 401,
  and logout.  Provides both stateless convenience methods (for bulk
  import/export) and a stateful sync interface (for building apps).

  Example:

    client = LeafClient('https://example.com/api/index.php', 'alice', 'hunter2')
    client.login()

    # List all notes
    for note in client.list_notes():
      print(note.id)

    # Export all notes
    changes = client.pull_all()
    for c in changes:
      print(c.key, c.obj['content'])
  '''

  def __init__(self, base_url: str, username: str, password: str) -> None:
    '''
    :param base_url: API base URL including path prefix
      (e.g. ``https://example.com/api/index.php``).
    :param username: Authentication username.
    :param password: Authentication password.
    '''
    ...

  # ── Auth ──────────────────────────────────────────────────────────

  def login(self) -> None:
    '''
    Authenticate with the server.  Stores the JWT access token in memory
    and the refresh cookie in the session's cookie jar.

    :raises LeafAuthError: If credentials are rejected.
    '''
    ...

  def logout(self) -> None:
    '''Invalidate the refresh token on the server and clear local state.'''
    ...

  def is_authenticated(self) -> bool:
    '''True if a non-expired JWT is held in memory.'''
    ...

  # ── Notes ─────────────────────────────────────────────────────────

  def list_notes(self) -> list[NoteInfo]:
    '''
    Return metadata for all live notes on the server.
    Uses the sync protocol internally (pull from revision 0).
    '''
    ...

  def get_note(self, id: str) -> Note:
    '''
    Return a single note by ID, including its full content.

    :param id: Note identifier.
    :raises LeafNotFoundError: If the note does not exist or is deleted.
    '''
    ...

  def put_note(self, id: str, content: str) -> None:
    '''
    Create or update a note.  If the note already exists, its content is
    replaced with *content*; otherwise a new note is created.

    Requires a round-trip to determine whether the note exists (needed
    to send the correct change type and version key).  For bulk operations,
    use :meth:`push_changes` with explicit ``CREATE`` changes.

    :param id: Note identifier.
    :param content: Note content (opaque to the server).
    '''
    ...

  def delete_note(self, id: str) -> None:
    '''Soft-delete a note (moves to trash).'''
    ...

  def rename_note(self, old_id: str, new_id: str) -> None:
    '''
    Rename a note.

    :param old_id: Current note identifier.
    :param new_id: New note identifier.
    :raises LeafAPIError: If the rename fails (e.g. target already exists).
    '''
    ...

  # ── Trash ──────────────────────────────────────────────────────────

  def list_trash(self) -> list[TrashEntry]:
    '''Return all soft-deleted notes (tombstones).'''
    ...

  def preview_trash(self, id: str) -> Note:
    '''Return content of a soft-deleted note without restoring it.'''
    ...

  def restore_note(self, id: str) -> Note:
    '''Restore a soft-deleted note back to live status.'''
    ...

  def purge_note(self, id: str) -> None:
    '''Hard-delete a single soft-deleted note permanently.'''
    ...

  def empty_trash(self) -> None:
    '''Hard-delete all soft-deleted notes permanently.'''
    ...

  # ── History ───────────────────────────────────────────────────────

  def history_list(self, id: str) -> list[VersionEntry]:
    '''Return the version chain for a note, newest first.'''
    ...

  def history_get(self, id: str, versions: list[str]) -> dict[str, str | None]:
    '''
    Return the content of specific version keys for a note.

    :param versions: List of version keys to fetch.
    :returns: Dict mapping version key → content (or None if not found).
    '''
    ...

  # ── SPA config ────────────────────────────────────────────────────

  def spa_config(self) -> dict:
    '''Return the SPA configuration exposed by the server.'''
    ...

  # ── Sync (stateless, for import/export scripts) ───────────────────

  def pull_all(self) -> list[Change]:
    '''
    Pull the full server state (revision 0, no local changes).

    Returns all current notes as Change objects (deduplicated — latest
    state per key only).
    '''
    ...

  def push_changes(self, changes: list[Change]) -> list[Change]:
    '''
    Push local changes to the server and return any server-side changes.

    Uses ``syncedRevision=0`` (stateless — the server returns everything
    since revision 0 in the response).  No prior pull is needed; the
    caller can ignore the response if only pushing.
    '''
    ...

  # ── Sync (stateful, for building apps) ────────────────────────────

  def sync(self, state: SyncState, changes: list[Change] | None = None,
           partial: bool = False) -> tuple[SyncState, list[Change]]:
    '''
    Push local changes and pull remote changes in one call.

    :param state: The client's current sync state (revision tracker).
    :param changes: Local changes to push (may be empty or None).
    :param partial: If True, the server accepts partial batches and
                    the caller will send more before expecting a
                    response.
    :returns: ``(new_state, remote_changes)`` — the caller should persist
              *new_state* for the next call.
    '''
    ...

  def pull(self, state: SyncState) -> tuple[SyncState, list[Change]]:
    '''
    Pull remote changes without pushing any local changes.

    :returns: ``(new_state, remote_changes)``.
    '''
    ...

  # ── Internal ──────────────────────────────────────────────────────

  def _request(self, method: str, endpoint: str,
               data: dict | None = None,
               params: dict | None = None) -> dict:
    '''
    Low-level HTTP request with automatic auth (attaches JWT, handles
    401 with refresh + retry).

    URL is ``{base_url}/{endpoint}``.  Query-string *params* are used
    only for the auth endpoint (``?action=login`` etc.).

    :param endpoint: API endpoint name (``'auth'``, ``'sync'``, etc.).
    :param data: JSON body dict (``Content-Type: application/json``).
    :param params: URL query-string parameters dict.
    :returns: Parsed JSON response dict.
    :raises LeafError: On any error response.
    '''
    ...

  def _ensure_auth(self) -> None:
    '''Check JWT expiry; refresh if needed. Raises on failure.'''
    ...

  def _refresh_token(self) -> None:
    '''POST /auth?action=refresh using the session's cookie jar.'''
    ...
```

### Auth lifecycle

1. `LeafClient.__init__()` stores credentials but does NOT call the server
2. `login()` calls `POST /auth?action=login`, stores JWT + cookie in `requests.Session`
3. Every `_request()` attaches `Authorization: Bearer <token>`
4. On 401 response: `_refresh_token()` → retry once → on failure, raise `LeafAuthError`
5. `_refresh_token()` deduplicates concurrent calls (shared promise)
6. `logout()` calls `POST /auth?action=logout`, clears local JWT

### Session management

The `requests.Session` handles cookies automatically — `login()` sets the
httpOnly refresh cookie in the session's cookie jar, and `_refresh_token()`
sends it back via the same session. The caller never touches cookies directly.

---

## Module: `leaf/cli.py`

argparse-based CLI with subcommands. Registered as console script `leaf` via
`setup.py` entry point.

### Global options

```
-h, --help          Show help
--version           Show version and exit
--url URL           Override server URL from config
--username USER     Override username from config
--password PASS     Override password from config
```

### Pattern syntax

Note-ID patterns use `fnmatch` globs (`*`, `?`, `[seq]`). For destructive
commands, patterns or `--all` are required.

### Subcommands

#### `leaf export DIR [pattern ...]`

Pull all notes from the server. Filter by note-ID patterns (fnmatch). Save
each note's content to `DIR/{id}.md`. No pattern → all notes.

- On Linux/macOS: note IDs with colons keep the colon in the filename
  (e.g. `work:meetings:notes` → `work:meetings:notes.md`).
- On Windows: colons are mapped to `_` (e.g. `work:meetings:notes` →
  `work_meetings_notes.md`).
- No frontmatter processing — plain content dump.

#### `leaf import DIR [pattern ...] [--collision skip|overwrite|rename]`

Read `.md` files from DIR and push them as new notes. The filename (minus `.md`)
becomes the note ID. Not recursive — only top-level files.

File patterns (shell globs) filter which files to import. Default: `*.md`.

- `--collision skip` (default): Skip notes whose ID already exists.
- `--collision overwrite`: Update existing notes with imported content.
- `--collision rename`: Append a numbered suffix (`-1`, `-2`, …) to
  conflicting IDs until a free ID is found.

#### `leaf list [pattern ...] [--trash]`

List note IDs and metadata. Without `--trash`: live notes. With `--trash`:
soft-deleted notes in trash.

#### `leaf get NOTE-ID`

Print a single note's content to stdout. NOTE-ID is a literal ID, not a
pattern. If the note does not exist → error.

#### `leaf put NOTE-ID [FILE]`

Create or update a note. If FILE is `-` or omitted, read content from stdin.

#### `leaf delete PATTERN ...`  or  `leaf delete --all`

Soft-delete notes matching any of the given patterns. Without patterns or
`--all` → error: "Use a glob pattern or --all."

Prompts: "Delete N notes? [y/N]". `-y` skips the prompt.

#### `leaf restore PATTERN ...`  or  `leaf restore --all`

Restore soft-deleted notes from trash matching patterns. Same confirmation
behaviour as `delete`.

#### `leaf purge PATTERN ...`  or  `leaf purge --all`

Hard-delete tombstones from trash permanently. Same confirmation behaviour.

#### `leaf empty-trash`

Hard-delete ALL tombstones. Requires `-y`. Without `-y` → error:
"Use -y to confirm permanent deletion of N notes."

#### `leaf rename OLD_ID NEW_ID`

Rename a single note. Both arguments are literal IDs (no patterns).

#### `leaf history NOTE-ID`

Show the version chain for a note (version keys, authors, timestamps).

#### `leaf login`

Test authentication against the server. Prints success/failure.

#### `leaf config`

Print resolved configuration (server URL, username, password masked).

---

## Testing

### Doctests (pure functions, no network)

Modules: `leaf/sync.py`, `leaf/models.py`, `leaf/config.py`.

Each function with doctest examples in its docstring. Run with:

```bash
python -m doctest leaf/sync.py leaf/models.py leaf/config.py -v
```

### Integration tests (against live PHP dev server)

File: `tests/test_client.py`. Uses `unittest.TestCase`.

Test fixture (``setUpClass`` in ``test_client.py``):

1. Copy ``api/`` and ``data/`` to a temp directory.
2. Create a test user via ``adduser.php``.
3. Start ``php -S localhost:PORT`` pointing to the temp directory.
4. After all tests (``tearDownClass``): kill server, remove temp directory.

Test cases:

- `test_login_logout` — happy path + wrong password
- `test_put_get_note` — create, read back, content roundtrip
- `test_list_notes` — empty list, list after create
- `test_delete_restore` — delete → list live excludes it → restore → back
- `test_rename` — rename old → new, verify old 404, new has content
- `test_trash_flow` — delete, list trash, preview, purge
- `test_empty_trash` — delete two notes, empty, verify trash empty
- `test_history` — create, update, verify version chain
- `test_pull_all` — creates a few notes, verifies all appear
- `test_push_changes` — push creates via Change objects
- `test_stateful_sync` — sync with SyncState tracking
- `test_collapse_queue` — doctest in sync.py covers this
- `test_deduplicate_changes` — doctest in sync.py covers this

Run with:

```bash
python -m unittest discover tests/
```

### One-command test runner

`tests/__init__.py` loads both doctest suites and integration TestCases,
so a single command runs everything:

```bash
python -m unittest
```

---

## `setup.py`

```python
from setuptools import setup, find_packages

setup(
  name='leaf',
  version='0.1.0',
  description='Python client and CLI for the Leaf notes API',
  packages=find_packages(),
  install_requires=[
    'requests',
    'pyyaml',
  ],
  python_requires='>=3.10',
  entry_points={
    'console_scripts': [
      'leaf=leaf.cli:main',
    ],
  },
)
```

---

## `leaf/__init__.py`

```python
'''Python client for the Leaf notes API.

Provides a Pythonic interface to all server endpoints plus a CLI for
bulk import/export.

Usage::

  from leaf.client import LeafClient
  from leaf.models import SyncState, Change, Note, NoteInfo
  from leaf.sync import CREATE, UPDATE, DELETE, RENAME, collapse_queue

  client = LeafClient('https://example.com/api/index.php', 'alice', 'hunter2')
  client.login()
  for note in client.list_notes():
    print(note.id)
'''

from leaf.client import LeafClient, LeafError, LeafAuthError, LeafNotFoundError, LeafAPIError
from leaf.models import NoteInfo, Note, Change, SyncState, VersionEntry, TrashEntry
from leaf.sync import CREATE, UPDATE, DELETE, RENAME, collapse_queue, deduplicate_changes
```
