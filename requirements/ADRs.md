# Architectural Decision Records

For now, NacoWiki remains for 0ink.net previews, and integrate it
with git.


## Backend

### `storage.php`: `next_rev()` is Inefficient?

`next_rev()` scans backwards from end-of-file byte-by-byte to find the last
line of `changelog.jsonl`.  It's called by `changelog_current_rev()` which is
called on **every sync request**.

Current approach:
- `fseek` to end, `ftell` the size
- Loop backwards in 256-byte chunks, `fread`, parse lines
- Find last non-empty line, parse JSON, extract `rev`

This is I/O-heavy for an append-only log that may grow large.

On the other hand, because each changelog record is fairly small,
we exoect that we are able to find the last `rev` within one or
at most two reads.


### Changelog Writes Use `flock()` on `fopen('a')` — Potential for Contention

`changelog_append()` uses `fopen('a')` + `flock(LOCK_EX)`.  On Linux,
appending in append-mode is atomic for writes under `PIPE_BUF` (4KB), so
the `flock` is technically redundant.  However, it's harmless and provides
correctness on all platforms.

`flock` is for cross-platform safety and interleaving protection on
non-POSIX filesystems.

### Others

* Manage dependancies with composer
* PHP with Storage backends using:
  * Flat Files
  * MySQL
  * Flat Files + Git
  * Matches potential shared hosting limitations (PHP and MySQL hosting)
* note contents kept opaque to support End to End Encryption.
  * Not for Git based backend.
* REST API end-points
  * Authentication using JWT with plugable user+password
  * user+password using imap (ddeboer/imap or webklex/php-imap)
  * Conflicts: take the newest, but conflicting version is added as previous version
* ~~Alternative:~~ Using Python with Fusion Passenger
  * Passenger benefits if the worker pools stick around.  However in shared hosting
    most likely the worker will get kill during idle timeout.  Furthermore Python would
    use more memory and would have a longer cold startup time.
* phase out the diff storage.
  * This an spiritual upgrade to an older [Wiki](https://github.com/iliu-net/NacoWiki/)
    implementation.  That implementation used diff storage.  It would
    only store the current version, and previous versions would be diff
    patches.  To restore a previous version, you would take the
    current version and apply diff patches until you reached the vesion
    you wanted. \
    For this application, we are dropping that idea:
    * The storage savings are minimal or this use case and does not
      justify the added complexity.
    * Also made restoring previous versions easily breakable.
    * Needs the content to be readable so will not allow end-to-end
      encryption.

## Front end

## CodeMirror 6 integration

Instead of using `@uiw/react-codemirror`, we are calling the
CodeMirror 6 API directly.  `@uiw/react-codemirror` would
save us about 30 lines of boiler plate, but for Leaf we will
still be calling the CodeMirror 6 API to fully implement the
features that we require.

### Others
* Features:
  * Offline-first
  * Fast sync
  * Good conflict handling
  * Secure authentication
  * Works on web shared hosting server
  * Markdown editor
* manage packages with: pnpm
* data store: Dexie + custom sync protocol
* Renderer:
  * markdown-it : most extensible
  * Alternates
    * marked + highlight.js - fast yet flexible
    * showdown - simple, beginner friendly
    * Unified / Remark / Rehype - Power User?
