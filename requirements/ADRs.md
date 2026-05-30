# Architectural Decision Records

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


## Front end
