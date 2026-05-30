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
* PHP + FlatFiles or MySQL (due to shared hosting limitations)
* note contents kept opaque -> End to End Encryption
* REST API end-points
  * Authentication using JWT with plugable user+password
  * user+password using imap (ddeboer/imap or webklex/php-imap)
  * Conflicts: take the newest, but conflicting version is added as previous version
* Alternative: Using Python with Fusion Passenger
  * Passenger benefits if the worker pools stick around.  However in shared hosting
    most likely the worker will get kill during idle timeout.  Furthermore Python would
    use more memory and would have a longer cold startup time.
* phase out the diff storage.  The savings are minimal because for this use case
  and does not justify the added complexity.  Also, would be interesting to add
  note content encryption which would break diff storage.

## Front end

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
