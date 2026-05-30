<?php
/**
 * storage.php — flat-file storage abstraction
 *
 * Required by all endpoints that read or write notes (sync.php, etc.).
 * All file I/O is isolated here so switching to MySQL later
 * means rewriting only this file.
 *
 * Storage layout:
 *   notes/{id}.json         — live note
 *   notes/{id}.deleted.json — soft-deleted tombstone (never purged)
 *   changelog.jsonl         — append-only change log
 *
 * Live note file structure ({id}.json):
 * {
 *   "current":    "2026-05-26:1:alice",
 *   "created_at": 1748200000,
 *   "created_by": "alice",
 *   "versions": {
 *     "2026-05-26:1:alice": {
 *       "author":    "alice",
 *       "saved_at":  1748200000,
 *       "content":   "<opaque blob>",
 *       "prev":      "2026-05-25:1:alice" | null,
 *       "exclusive": true
 *     }
 *   }
 * }
 *
 * Tombstone file structure ({id}.deleted.json):
 * Same as the live note, plus two extra top-level fields:
 * {
 *   "current":    "2026-05-26:1:alice",
 *   "created_at": 1748200000,
 *   "created_by": "alice",
 *   "deleted_at": 1748350000,
 *   "deleted_by": "alice",
 *   "versions": { ... }
 * }
 *   deleted_at  — when the note was soft-deleted (Unix seconds)
 *   deleted_by  — username who performed the deletion
 *
 *   created_by     — original creator, set on first write, never overwritten
 *   versions.*.author     — who wrote this specific version
 *   versions.*.exclusive  — true until another user fetches this version via sync;
 *                           when false, the next save by the original author creates
 *                           a new version instead of overwriting
 *
 * Version key format: "{date}:{counter}:{author}"
 *   Lexicographic sort == chronological order.
 *   Counter resets per (date, author) pair.
 *   The author in the key is a convenience duplicate of the 'author' field;
 *   the 'author' field is authoritative and the key format may evolve independently
 *   (e.g. to UUIDs).
 *
 * Changelog entry:
 * {"rev":N,"file":"id","type":"CREATE|UPDATE|DELETE|RENAME",
 *  "ts":N,"version":"key"|null,"prev_version":"key"|null,
 *  "renamed_to":"new-id","renamed_by":"author",          // RENAME only
 *  "deleted_by":"author"}                                // DELETE only
 *
 * Target MySQL schema (normalized — for future migration):
 *
 *   CREATE TABLE notes (
 *     id         VARCHAR(200) PRIMARY KEY,
 *     current    VARCHAR(100),
 *     created_at INT NOT NULL,
 *     created_by VARCHAR(100) NOT NULL DEFAULT '',
 *     deleted    TINYINT NOT NULL DEFAULT 0,
 *     deleted_at INT DEFAULT NULL,
 *     deleted_by VARCHAR(100) NOT NULL DEFAULT ''
 *   );
 *
 *   CREATE TABLE versions (
 *     note_id     VARCHAR(200) NOT NULL,
 *     version_key VARCHAR(100) NOT NULL,
 *     author      VARCHAR(100) NOT NULL DEFAULT '',
 *     saved_at    INT NOT NULL,
 *     content     LONGTEXT NOT NULL,
 *     prev        VARCHAR(100),
 *     exclusive   TINYINT NOT NULL DEFAULT 1,
 *     PRIMARY KEY (note_id, version_key),
 *     FOREIGN KEY (note_id) REFERENCES notes(id)
 *   );
 *
 *   CREATE TABLE changelog (
 *     rev          INT AUTO_INCREMENT PRIMARY KEY,
 *     file         VARCHAR(200) NOT NULL,
 *     type         ENUM('CREATE','UPDATE','DELETE','RENAME') NOT NULL,
 *     ts           INT NOT NULL,
 *     version      VARCHAR(100),
 *     prev_version VARCHAR(100),
 *     renamed_to   VARCHAR(200),
 *     renamed_by   VARCHAR(100) NOT NULL DEFAULT '',
 *     deleted_by   VARCHAR(100) NOT NULL DEFAULT '',
 *     INDEX (rev)
 *   );
 */

if (!is_dir(NOTES_DIR)) mkdir(NOTES_DIR, 0755, true);

// ─────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────

/**
 * Get the filesystem path for a live note file.
 *
 * @param string $id  Note identifier
 * @return string     Full path to the note JSON file
 */
function note_path(string $id): string {
    return NOTES_DIR . $id . '.json';
}

/**
 * Get the filesystem path for a soft-deleted note tombstone.
 *
 * @param string $id  Note identifier
 * @return string     Full path to the .deleted.json tombstone
 */
function deleted_path(string $id): string {
    return NOTES_DIR . $id . '.deleted.json';
}

// ─────────────────────────────────────────────
// Note CRUD
// ─────────────────────────────────────────────

/**
 * Check whether a note has been soft-deleted.
 *
 * A deleted note exists as a {id}.deleted.json tombstone file.
 *
 * @param string $id  Note identifier
 * @return bool       True if the note has been soft-deleted
 */
function note_is_deleted(string $id): bool {
    return file_exists(deleted_path($id));
}

/**
 * Check whether a note exists as a live (non-deleted) file.
 *
 * A note exists if there is a {id}.json file and no corresponding
 * {id}.deleted.json tombstone.
 *
 * @param string $id  Note identifier
 * @return bool       True if the note exists and is not deleted
 */
function storage_note_exists(string $id): bool {
    return !note_is_deleted($id) && file_exists(note_path($id));
}

/**
 * Read a live note file.
 *
 * Returns null if the note does not exist or has been soft-deleted.
 * The returned array contains 'current', 'created_at', and 'versions' keys.
 *
 * MySQL equivalent:
 *   SELECT n.*, v.* FROM notes n
 *   LEFT JOIN versions v ON v.note_id = n.id
 *   WHERE n.id = ? AND n.deleted = 0
 *   ORDER BY v.version_key
 *
 * @param string $id  Note identifier
 * @return array|null  Note data array, or null if not found or deleted
 */
function storage_get_note(string $id): ?array {
    if (note_is_deleted($id)) return null;
    $path = note_path($id);
    if (!file_exists($path)) return null;
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

/**
 * Write a note file atomically using temp file + rename.
 *
 * Creates the note if it does not exist. The $data array must contain
 * 'current', 'created_at', and 'versions' keys matching the note schema.
 *
 * MySQL equivalent:
 *   INSERT INTO notes ... ON DUPLICATE KEY UPDATE current = ?
 *   + INSERT/REPLACE INTO versions ...
 *
 * @param string $id    Note identifier
 * @param array  $data  Complete note data structure
 * @return void
 */
function storage_put_note(string $id, array $data): void {
    $path = note_path($id);
    $tmp  = $path . '.tmp.' . getmypid();
    file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    rename($tmp, $path);
}

/**
 * Soft-delete a note by embedding deleted_at and deleted_by and writing
 * the .deleted.json tombstone (preserving full version history).
 *
 * Idempotent — safe to call on an already-deleted note.
 *
 * @param string $id          Note identifier
 * @param string $deleted_by  Username who performed the deletion
 * @return void
 */
function storage_delete_note(string $id, string $deleted_by = ''): void {
    $path = note_path($id);
    if (!file_exists($path) || note_is_deleted($id)) return;

    $data = json_decode(file_get_contents($path), true);
    if (is_array($data)) {
        $data['deleted_at'] = time();
        $data['deleted_by'] = $deleted_by;
        file_put_contents(deleted_path($id), json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
    unlink($path);
}

/**
 * Revive a soft-deleted note by restoring its full content from the
 * tombstone (including version history).
 *
 * Reads .deleted.json, strips the deleted_at / deleted_by fields, writes .json,
 * then removes the tombstone.
 *
 * Idempotent — safe to call on a note that is not deleted.
 *
 * @param string $id  Note identifier
 * @return void
 */
function storage_revive_note(string $id): void {
    $path = deleted_path($id);
    if (!file_exists($path)) return;

    $data = json_decode(file_get_contents($path), true);
    if (is_array($data)) {
        unset($data['deleted_at']);
        unset($data['deleted_by']);
        file_put_contents(note_path($id), json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
    unlink($path);
}

// ─────────────────────────────────────────────
// Soft-delete maintenance
// ─────────────────────────────────────────────

/**
 * Permanently remove tombstones whose deleted_at is older than
 * DELETED_NOTE_TTL_DAYS.
 *
 * Called by the daily purge hook in sync.php.  Tombstones without a
 * deleted_at field (legacy format) are treated as exempt so we never
 * accidentally lose data from before the feature was added.
 *
 * @return int  Number of tombstones removed
 */
function storage_purge_deleted_notes(): int {
    $cutoff  = time() - (DELETED_NOTE_TTL_DAYS * 86400);
    $removed = 0;

    foreach (glob(NOTES_DIR . '*.deleted.json') ?: [] as $path) {
        $data = json_decode(file_get_contents($path), true);
        $ts   = $data['deleted_at'] ?? null;
        if ($ts !== null && (int)$ts < $cutoff) {
            unlink($path);
            $removed++;
        }
    }

    return $removed;
}

/**
 * Immediately hard-delete a single tombstone (no TTL check).
 *
 * Idempotent — no-op if the tombstone does not exist.
 *
 * @param string $id  Note identifier
 * @return void
 */
function storage_hard_delete_note(string $id): void {
    $path = deleted_path($id);
    if (file_exists($path)) {
        unlink($path);
    }
}

/**
 * Return metadata for all soft-deleted notes.
 *
 * Each entry includes the deleted_at timestamp and deleted_by username
 * from the tombstone.  Entries without these fields (legacy) return null
 * for deleted_at and empty string for deleted_by.
 *
 * @return array<int, array{id: string, deleted_at: int|null, deleted_by: string}>
 */
function storage_list_deleted_notes(): array {
    $paths = glob(NOTES_DIR . '*.deleted.json') ?: [];
    $notes = [];

    foreach ($paths as $path) {
        $data = json_decode(file_get_contents($path), true);
        $notes[] = [
            'id'         => basename($path, '.deleted.json'),
            'deleted_at' => (isset($data['deleted_at']) && is_int($data['deleted_at']))
                ? $data['deleted_at']
                : null,
            'deleted_by' => $data['deleted_by'] ?? '',
        ];
    }

    usort($notes, fn($a, $b) => strcmp($a['id'], $b['id']));
    return $notes;
}

/**
 * Rename a live note by moving its JSON file.
 *
 * Both files must be on the same filesystem, so PHP's rename() is atomic.
 * The full version history, prev pointers, and created_at all move intact.
 * Returns true on success, false if the new name already exists or either
 * note is in a deleted state.
 *
 * @param string $old_id  Current note identifier
 * @param string $new_id  New note identifier
 * @return bool           True if the rename succeeded
 */
function storage_rename_note(string $old_id, string $new_id): bool {
    if (note_is_deleted($old_id)) return false;
    if (note_is_deleted($new_id)) return false;
    if (!file_exists(note_path($old_id))) return false;
    if (file_exists(note_path($new_id))) return false;

    return rename(note_path($old_id), note_path($new_id));
}

/**
 * Return metadata for all live notes (no content), sorted by id.
 *
 * Used by sync.php to build the server changes response.
 *
 * MySQL equivalent:
 *   SELECT n.id, n.created_at, n.current,
 *          v.saved_at AS updated_at
 *   FROM notes n
 *   LEFT JOIN versions v ON v.note_id = n.id AND v.version_key = n.current
 *   WHERE n.deleted = 0
 *   ORDER BY n.id
 *
 * @return array<int, array{id: string, created_at: int, updated_at: int, current: string|null}>
 */
function storage_list_notes(): array {
    $files = glob(NOTES_DIR . '*.json') ?: [];
    $files = array_filter($files, fn($f) =>
        !str_contains($f, '.tmp.') && !str_ends_with($f, '.deleted.json')
    );

    $notes = [];
    foreach ($files as $file) {
        $data = json_decode(file_get_contents($file), true);
        if (!is_array($data)) continue;

        $current  = $data['current'] ?? null;
        $saved_at = ($current && isset($data['versions'][$current]))
            ? $data['versions'][$current]['saved_at']
            : ($data['created_at'] ?? filemtime($file));

        $notes[] = [
            'id'         => basename($file, '.json'),
            'created_at' => $data['created_at'] ?? filemtime($file),
            'updated_at' => $saved_at,
            'current'    => $current,
        ];
    }

    usort($notes, fn($a, $b) => strcmp($a['id'], $b['id']));
    return $notes;
}

// ─────────────────────────────────────────────
// Version resolution
// ─────────────────────────────────────────────

/**
 * Compute the version key for an incoming save and whether it overwrites.
 *
 * Overwrite rule: same author AND same UTC date AND the current version's
 *                 exclusive flag is still true (nobody else has received it).
 * New version:    everything else — find highest counter for (date, author)
 *                 in existing keys and increment.
 *
 * The exclusive flag is set to false when a *different* user syncs/receives
 * this version.  This prevents overwriting a version that another client
 * may have already seen — the next save creates a new version instead.
 *
 * @param array  $note    Note data array with 'versions' and 'current' keys
 * @param string $author  Username making the write
 * @return array{0: string, 1: bool}  [version_key, is_overwrite]
 */
function storage_resolve_version(array $note, string $author): array {
    $today    = gmdate('Y-m-d');
    $versions = $note['versions'] ?? [];
    $current  = $note['current']  ?? null;

    if ($current) {
        $cur_author = $note['versions'][$current]['author'] ?? '';
        $cur_date   = gmdate('Y-m-d', $note['versions'][$current]['saved_at'] ?? 0);
        $exclusive  = $note['versions'][$current]['exclusive'] ?? false;

        if ($cur_author === $author && $cur_date === $today && $exclusive) {
            return [$current, true];               // overwrite same slot
        }
    }

    // Find highest counter for (today, author) to build the new key
    $prefix  = $today . ':';
    $suffix  = ':' . $author;
    $max_ctr = 0;

    foreach (array_keys($versions) as $key) {
        if (str_starts_with($key, $prefix) && str_ends_with($key, $suffix)) {
            $parts   = explode(':', $key, 3);
            $max_ctr = max($max_ctr, (int)($parts[1] ?? 0));
        }
    }

    return [$today . ':' . ($max_ctr + 1) . ':' . $author, false];
}

/**
 * Write a new version of a note's content.  Each version carries an
 * `exclusive` flag that starts true and is cleared when another user
 * receives this version via sync (see storage_mark_version_seen).
 *
 * @param string $id       Note identifier
 * @param string $content  Note content (opaque — not inspected)
 * @param string $author   Username making the write
 * @return string          The version key that was written
 */
function storage_apply_write(string $id, string $content, string $author): string {
    $note = storage_get_note($id);
    $is_new = ($note === null);

    $note = $note ?? [
        'current'    => null,
        'created_at' => time(),
        'versions'   => [],
    ];

    // Record the original creator on the first write (never overwritten).
    if ($is_new) {
        $note['created_by'] = $author;
    }

    [$vkey, $overwrite] = storage_resolve_version($note, $author);

    $prev_vkey = $overwrite
        ? ($note['versions'][$vkey]['prev'] ?? null)
        : $note['current'];

    $note['versions'][$vkey] = [
        'author'    => $author,
        'saved_at'  => time(),
        'content'   => $content,
        'prev'      => $prev_vkey,
        'exclusive' => true,
    ];

    ksort($note['versions']);
    $note['current'] = $vkey;

    storage_put_note($id, $note);
    return $vkey;
}

// ─────────────────────────────────────────────
// Version-exclusive flag
// ─────────────────────────────────────────────

/**
 * Mark the current version of a note as "seen" by a user who is not its
 * author, setting exclusive to false so the next save by the original
 * author creates a new version instead of overwriting.
 *
 * Called during sync response building for every note whose content is
 * being delivered to a client whose username differs from the version
 * author.  Idempotent — safe to call multiple times.
 *
 * @param string $id      Note identifier
 * @param string $viewer  Username receiving this version
 * @return void
 */
function storage_mark_version_seen(string $id, string $viewer): void {
    $note = storage_get_note($id);
    if (!$note) return;

    $current_vkey = $note['current'] ?? null;
    if (!$current_vkey) return;

    $author = $note['versions'][$current_vkey]['author'] ?? '';

    if ($author !== $viewer) {
        // Another user is receiving this version → clear exclusivity
        $note['versions'][$current_vkey]['exclusive'] = false;
        storage_put_note($id, $note);
    }
}

// ─────────────────────────────────────────────
// Changelog
// ─────────────────────────────────────────────

/**
 * Append one entry to the append-only changelog file.
 *
 * Uses flock() so concurrent appends don't interleave.
 *
 * MySQL equivalent:
 *   INSERT INTO changelog (file, type, ts, version, prev_version)
 *   VALUES (?, ?, ?, ?, ?)
 *   -- AUTO_INCREMENT handles rev
 *
 * @param array $entry  Changelog entry with keys: rev, file, type, ts, version, prev_version
 * @return void
 */
function changelog_append(array $entry): void {
    $fh = fopen(CHANGELOG_FILE, 'a');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    fwrite($fh, json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n");
    flock($fh, LOCK_UN);
    fclose($fh);
}

/**
 * Return the next revision number (max rev + 1).
 *
 * Reads the last non-empty line of the changelog by scanning backwards
 * from end of file — avoids loading the entire log into memory.
 *
 * MySQL equivalent:
 *   SELECT COALESCE(MAX(rev), 0) + 1 FROM changelog
 *
 * @return int  The next revision number (1 if changelog is empty or missing)
 */
function next_rev(): int {
    if (!file_exists(CHANGELOG_FILE)) return 1;

    $fh = fopen(CHANGELOG_FILE, 'r');
    if (!$fh) return 1;

    fseek($fh, 0, SEEK_END);
    $size = ftell($fh);
    if ($size === 0) { fclose($fh); return 1; }

    $buf  = '';
    $pos  = $size;
    $last = '';

    while ($pos > 0) {
        $chunk = min(256, $pos);
        $pos  -= $chunk;
        fseek($fh, $pos);
        $buf = fread($fh, $chunk) . $buf;
        foreach (array_reverse(explode("\n", rtrim($buf))) as $line) {
            $line = trim($line);
            if ($line !== '') { $last = $line; break 2; }
        }
    }
    fclose($fh);

    if ($last === '') return 1;
    $entry = json_decode($last, true);
    return isset($entry['rev']) ? (int)$entry['rev'] + 1 : 1;
}

/**
 * Return all changelog entries with rev > $since, in ascending order.
 *
 * Used by sync.php to build the server changes response.
 *
 * MySQL equivalent:
 *   SELECT * FROM changelog WHERE rev > ? ORDER BY rev ASC
 *
 * @param int $since  Return only entries with revision greater than this
 * @return array<int, array>  Changelog entries (empty array if none or file missing)
 */
function changelog_since(int $since): array {
    if (!file_exists(CHANGELOG_FILE)) return [];

    $entries = [];
    $fh      = fopen(CHANGELOG_FILE, 'r');
    if (!$fh) return [];

    while (($line = fgets($fh)) !== false) {
        $line = trim($line);
        if ($line === '') continue;
        $entry = json_decode($line, true);
        if (!is_array($entry)) continue;
        if ((int)($entry['rev'] ?? 0) > $since) {
            $entries[] = $entry;
        }
    }

    fclose($fh);
    return $entries;   // already in ascending order (append-only log)
}

/**
 * Return the highest revision number currently in the changelog.
 *
 * MySQL equivalent:
 *   SELECT COALESCE(MAX(rev), 0) FROM changelog
 *
 * @return int  Current revision number, or 0 if changelog is empty
 */
function changelog_current_rev(): int {
    return next_rev() - 1;
}

/**
 * Return the revision number of the oldest surviving changelog entry.
 *
 * Reads only the first non-empty line of the changelog — O(1) I/O.
 * Used to detect when a client's syncedRevision falls before the
 * truncated portion of the log.
 *
 * @return int  Earliest rev, or 1 if changelog is empty
 */
function changelog_earliest_rev(): int {
    if (!file_exists(CHANGELOG_FILE)) return 1;

    $fh = fopen(CHANGELOG_FILE, 'r');
    if (!$fh) return 1;

    while (($line = fgets($fh)) !== false) {
        $line = trim($line);
        if ($line === '') continue;
        $entry = json_decode($line, true);
        $rev   = is_array($entry) ? ($entry['rev'] ?? null) : null;
        if (is_int($rev)) {
            fclose($fh);
            return $rev;
        }
    }

    fclose($fh);
    return 1;
}

/**
 * Returns the E2EE support for this storage implementation.
 *
 * Not all backends are able to support E2EE semantics.  This fuction
 * lets the sync protocol and the SPA application know what can be
 * supported.
 *
 * @return bool true if E2EE can be supported, false if it is not
 */
function storage_e2ee_support(): bool { return true; }
