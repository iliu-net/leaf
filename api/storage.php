<?php
/**
 * storage.php — flat-file storage abstraction
 *
 * Required by api.php and sync.php.
 * All file I/O is isolated here so switching to MySQL later
 * means rewriting only this file.
 *
 * Storage layout:
 *   notes/{id}.json         — live note
 *   notes/{id}.deleted.json — soft-deleted tombstone (never purged)
 *   changelog.jsonl         — append-only change log
 *
 * Note file structure:
 * {
 *   "current":    "2025-05-21:1:anonymous",
 *   "created_at": 1716163200,
 *   "versions": {
 *     "2025-05-21:1:anonymous": {
 *       "saved_at": 1716249600,
 *       "content":  "<opaque blob>",
 *       "prev":     "2025-05-20:1:anonymous" | null
 *     }
 *   }
 * }
 *
 * Version key format: "{date}:{counter}:{author}"
 *   Lexicographic sort == chronological order.
 *   Counter resets per (date, author) pair.
 *
 * Changelog entry:
 * {"rev":N,"file":"id","type":"CREATE|UPDATE|DELETE",
 *  "ts":N,"version":"key"|null,"prev_version":"key"|null}
 *
 * Target MySQL schema (normalized — for future migration):
 *
 *   CREATE TABLE notes (
 *     id         VARCHAR(200) PRIMARY KEY,
 *     current    VARCHAR(100),
 *     created_at INT NOT NULL,
 *     deleted    TINYINT NOT NULL DEFAULT 0
 *   );
 *
 *   CREATE TABLE versions (
 *     note_id     VARCHAR(200) NOT NULL,
 *     version_key VARCHAR(100) NOT NULL,
 *     saved_at    INT NOT NULL,
 *     content     LONGTEXT NOT NULL,
 *     prev        VARCHAR(100),
 *     PRIMARY KEY (note_id, version_key),
 *     FOREIGN KEY (note_id) REFERENCES notes(id)
 *   );
 *
 *   CREATE TABLE changelog (
 *     rev          INT AUTO_INCREMENT PRIMARY KEY,
 *     file         VARCHAR(200) NOT NULL,
 *     type         ENUM('CREATE','UPDATE','DELETE') NOT NULL,
 *     ts           INT NOT NULL,
 *     version      VARCHAR(100),
 *     prev_version VARCHAR(100),
 *     INDEX (rev)
 *   );
 */

require_once __DIR__ . '/config.php';

if (!is_dir(NOTES_DIR)) mkdir(NOTES_DIR, 0755, true);

// ─────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────

function note_path(string $id): string {
    return NOTES_DIR . $id . '.json';
}

function deleted_path(string $id): string {
    return NOTES_DIR . $id . '.deleted.json';
}

// ─────────────────────────────────────────────
// Note CRUD
// ─────────────────────────────────────────────

/** Returns true if the note has been soft-deleted. */
function note_is_deleted(string $id): bool {
    return file_exists(deleted_path($id));
}

/** Returns true if the note exists as a live (non-deleted) file. */
function storage_note_exists(string $id): bool {
    return !note_is_deleted($id) && file_exists(note_path($id));
}

/**
 * Read a live note file.
 * Returns null if the note does not exist or has been soft-deleted.
 *
 * MySQL equivalent:
 *   SELECT n.*, v.* FROM notes n
 *   LEFT JOIN versions v ON v.note_id = n.id
 *   WHERE n.id = ? AND n.deleted = 0
 *   ORDER BY v.version_key
 */
function storage_get_note(string $id): ?array {
    if (note_is_deleted($id)) return null;
    $path = note_path($id);
    if (!file_exists($path)) return null;
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

/**
 * Write a note atomically (temp file + rename).
 * Creates the note if it does not exist.
 *
 * MySQL equivalent:
 *   INSERT INTO notes ... ON DUPLICATE KEY UPDATE current = ?
 *   + INSERT/REPLACE INTO versions ...
 */
function storage_put_note(string $id, array $data): void {
    $path = note_path($id);
    $tmp  = $path . '.tmp.' . getmypid();
    file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    rename($tmp, $path);
}

/**
 * Soft-delete a note: rename .json → .deleted.json.
 * Idempotent — safe to call on an already-deleted note.
 *
 * MySQL equivalent:
 *   UPDATE notes SET deleted = 1 WHERE id = ?
 */
function storage_delete_note(string $id): void {
    $path = note_path($id);
    if (file_exists($path) && !note_is_deleted($id)) {
        rename($path, deleted_path($id));
    }
}

/**
 * Return metadata for all live notes (no content), sorted by id.
 * Used by api.php ?action=list.
 *
 * MySQL equivalent:
 *   SELECT n.id, n.created_at, n.current,
 *          v.saved_at AS updated_at
 *   FROM notes n
 *   LEFT JOIN versions v ON v.note_id = n.id AND v.version_key = n.current
 *   WHERE n.deleted = 0
 *   ORDER BY n.id
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
 * Overwrite rule: same author AND same UTC date as the current version.
 * New version:    everything else — find highest counter for (date, author)
 *                 in existing keys and increment.
 *
 * Author and date are encoded in the key "{date}:{counter}:{author}",
 * so they are parsed back out rather than stored redundantly.
 *
 * Returns [$version_key, $is_overwrite].
 */
function storage_resolve_version(array $note, string $author): array {
    $today    = gmdate('Y-m-d');
    $versions = $note['versions'] ?? [];
    $current  = $note['current']  ?? null;

    if ($current) {
        $parts      = explode(':', $current, 3);   // [date, counter, author]
        $cur_date   = $parts[0] ?? '';
        $cur_author = $parts[2] ?? '';

        if ($cur_author === $author && $cur_date === $today) {
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
 * Apply a write (CREATE or UPDATE) to a note and persist it.
 * Returns the version key that was written.
 *
 * This is the single write path shared by api.php and sync.php.
 */
function storage_apply_write(string $id, string $content, string $author): string {
    $note = storage_get_note($id) ?? [
        'current'    => null,
        'created_at' => time(),
        'versions'   => [],
    ];

    [$vkey, $overwrite] = storage_resolve_version($note, $author);

    $prev_vkey = $overwrite
        ? ($note['versions'][$vkey]['prev'] ?? null)
        : $note['current'];

    $note['versions'][$vkey] = [
        'saved_at' => time(),
        'content'  => $content,
        'prev'     => $prev_vkey,
    ];

    ksort($note['versions']);
    $note['current'] = $vkey;

    storage_put_note($id, $note);
    return $vkey;
}

// ─────────────────────────────────────────────
// Changelog
// ─────────────────────────────────────────────

/**
 * Append one entry to the changelog.
 * Uses flock() so concurrent appends don't interleave.
 *
 * MySQL equivalent:
 *   INSERT INTO changelog (file, type, ts, version, prev_version)
 *   VALUES (?, ?, ?, ?, ?)
 *   -- AUTO_INCREMENT handles rev
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
 * Reads the last non-empty line of the changelog backwards.
 *
 * MySQL equivalent:
 *   SELECT COALESCE(MAX(rev), 0) + 1 FROM changelog
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
 * Used by sync.php to build the server changes response.
 *
 * MySQL equivalent:
 *   SELECT * FROM changelog WHERE rev > ? ORDER BY rev ASC
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
 * Return the highest rev currently in the changelog, or 0 if empty.
 *
 * MySQL equivalent:
 *   SELECT COALESCE(MAX(rev), 0) FROM changelog
 */
function changelog_current_rev(): int {
    return next_rev() - 1;
}
