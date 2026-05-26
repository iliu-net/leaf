<?php
/**
 * sync.php — sync protocol endpoint (poll pattern)
 *
 * Single POST endpoint that handles both push and pull of note changes.
 * Uses a polling pattern — suitable for shared hosting where WebSockets
 * and long-polling are unavailable.
 *
 * Protocol (single POST endpoint):
 *
 *   Request body:
 *   {
 *     "baseRevision":   12,      // revision client's changes are based on
 *     "syncedRevision": 15,      // last revision client has seen from server
 *     "changes": [               // local changes to apply (may be empty)
 *       {
 *         "type": 1|2|3,         // 1=CREATE 2=UPDATE 3=DELETE
 *         "key":  "note-id",
 *         "obj":  {              // null for DELETE
 *           "id":      "note-id",
 *           "content": "<opaque>"
 *         }
 *       }
 *     ],
 *     "partial": false           // true if client is sending changes in batches
 *   }
 *
 *   Response body:
 *   {
 *     "changes":         [...],  // server changes since syncedRevision
 *     "currentRevision": 18,     // server's current revision after applying changes
 *     "partial":         false   // always false — we send all changes at once
 *   }
 *
 * Conflict strategy: last-write-wins at the version level.
 *   The server always accepts incoming changes. If a competing change has
 *   already been written (baseRevision < server current), both survive as
 *   separate version history entries linked by the prev pointer chain.
 *   The client receives the competing version in the response and reconciles
 *   locally. Old versions are preserved for future 3-way merge UI.
 *
 * Content opacity:
 *   obj.content is stored and returned as-is. sync.php never reads it.
 *   This makes E2EE a pure client-side addition with no server changes.
 *
 * Dexie change type constants:
 *   const DEXIE_CREATE = 1;
 *   const DEXIE_UPDATE = 2;
 *   const DEXIE_DELETE = 3;
 */

require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/auth_guard.php';

// ── Dexie change type constants ────────────────────────────────────────────

const DEXIE_CREATE = 1;
const DEXIE_UPDATE = 2;
const DEXIE_DELETE = 3;
const DEXIE_RENAME = 4;

header('Access-Control-Allow-Origin: ' . CORS_ALLOW_POLICY);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json');

// OPTIONS preflight must bypass auth — browser sends it without Authorization header
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST required']);
    exit;
}

$author = require_auth();   // exits with 401 if token missing/invalid

// ── Daily purge of expired tombstones ──────────
$purgeFile = DATA_ROOT . 'last_purge.txt';
$lastPurge = file_exists($purgeFile) ? (int)file_get_contents($purgeFile) : 0;
if (time() - $lastPurge > 86400) {
    storage_purge_deleted_notes();
    file_put_contents($purgeFile, (string)time());
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Send a JSON response and terminate execution.
 *
 * @param mixed $data  Data to encode as JSON
 * @return never
 */
function respond(mixed $data): never {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Send a JSON error response and terminate execution.
 *
 * @param string $msg   Error message
 * @param int    $code  HTTP status code (default 400)
 * @return never
 */
function fail(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

/**
 * Sanitize a note identifier received from the client.
 *
 * Maps directory separators (/) to colons to prevent path traversal.
 * Replaces leading dots with underscore (prevents hidden files and "." / "..").
 * Strips any remaining unsafe characters, allowing a broad set of
 * printable special characters alongside alphanumerics.
 *
 * @param string $raw  Raw note identifier from client input
 * @return string      Sanitized, safe identifier
 */
function safe_id(string $raw): string {
    $raw = trim($raw);
    // Map directory separators to colon (preserves logical paths safely)
    $raw = str_replace('/', ':', $raw);
    // Replace leading dots with underscore (prevents hidden files and "." / "..")
    $raw = preg_replace('/^\.+/', '_', $raw);
    // Strip any remaining unsafe characters
    return preg_replace('/[^a-zA-Z0-9_\-\.$%\'@~!(){}^#&`:]/u', '_', $raw);
}

// ─────────────────────────────────────────────
// Apply client changes
// ─────────────────────────────────────────────

/**
 * Apply a single client change to storage and write a changelog entry.
 *
 * Returns the changelog entry written, or null if the change was skipped
 * (e.g. unknown type, empty key, or note was already deleted).
 *
 * @param array  $change  Change object with keys: type, key, obj
 * @param string $author  Authenticated username applying the change
 * @return array|null     Changelog entry written, or null if skipped
 */
function apply_client_change(array $change, string $author): ?array {
    $type = (int)($change['type'] ?? 0);
    $key  = safe_id((string)($change['key'] ?? ''));
    $obj  = $change['obj'] ?? null;   // null for DELETE

    if ($key === '') return null;

    // ── All non-DELETE operations require a version field ──────
    if ($type !== DEXIE_DELETE && $obj !== null) {
        $incoming_version = $obj['version'] ?? null;
        if ($incoming_version === null || $incoming_version === '') {
            // Version is required — reject
            return null;
        }
    }

    // ── CREATE or UPDATE ──────────────────────
    if ($type === DEXIE_CREATE || $type === DEXIE_UPDATE) {
        $content = (string)($obj['content'] ?? '');

        if (note_is_deleted($key)) {
            // Tombstone exists — revive (remove tombstone) so the note
            // can be re-created or updated rather than silently ignored.
            storage_revive_note($key);
        }

        // Capture current version before the write for conflict detection
        $pre_note  = storage_get_note($key);
        $is_new    = $pre_note === null;

        // Conflict detection: if the note already existed and the client's
        // base version doesn't match the server's current version, another
        // client has made a competing edit.  We still accept the write (both
        // versions survive in the chain) and flag it for future UI.
        if (!$is_new && $pre_note['current'] !== null && $pre_note['current'] !== $incoming_version) {
            error_log("Conflict on {$key}: client {$incoming_version} != server {$pre_note['current']}");
        }

        $vkey = storage_apply_write($key, $content, $author);

        // Read back the prev pointer storage_apply_write computed
        $note      = storage_get_note($key);
        $prev_vkey = $note['versions'][$vkey]['prev'] ?? null;

        $entry = [
            'rev'          => next_rev(),
            'file'         => $key,
            'type'         => $is_new ? 'CREATE' : 'UPDATE',
            'ts'           => time(),
            'version'      => $vkey,
            'prev_version' => $prev_vkey,
        ];
        changelog_append($entry);
        return $entry;
    }

    // ── DELETE ────────────────────────────────
    if ($type === DEXIE_DELETE) {
        // Idempotent — already deleted is fine
        if (note_is_deleted($key)) return null;
        if (!storage_note_exists($key)) return null;

        $note    = storage_get_note($key);
        $current = $note['current'] ?? null;

        storage_delete_note($key);

        $entry = [
            'rev'          => next_rev(),
            'file'         => $key,
            'type'         => 'DELETE',
            'ts'           => time(),
            'version'      => null,
            'prev_version' => $current,
        ];
        changelog_append($entry);
        return $entry;
    }

    // ── RENAME ────────────────────────────────
    if ($type === DEXIE_RENAME) {
        $new_id = safe_id($obj['renamed_to'] ?? '');
        if ($new_id === '') return null;
        if (!storage_note_exists($key)) return null;
        if (storage_note_exists($new_id)) return null;
        // If target is tombstoned, remove it so the rename succeeds
        // (the target's old content is replaced by the source's content)
        if (note_is_deleted($new_id)) storage_hard_delete_note($new_id);

        if (!storage_rename_note($key, $new_id)) return null;

        $entry = [
            'rev'          => next_rev(),
            'file'         => $key,
            'type'         => 'RENAME',
            'ts'           => time(),
            'renamed_to'   => $new_id,
            'version'      => null,
            'prev_version' => null,
        ];
        changelog_append($entry);
        return $entry;
    }

    return null;   // unknown type — skip
}

// ─────────────────────────────────────────────
// Build server changes response
// ─────────────────────────────────────────────

/**
 * Convert a changelog entry into a change object for the sync response.
 *
 * Returns null if the note file cannot be read (e.g. race condition
 * where a note was deleted between the changelog write and this read).
 *
 * @param array $entry  Changelog entry with keys: file, type, version, prev_version, renamed_to
 * @return array{type: int, key: string, obj: array|null}|null  Change object for response
 */
function changelog_entry_to_dexie_change(array $entry): ?array {
    $key  = $entry['file'] ?? '';
    $type = $entry['type'] ?? '';

    $version      = $entry['version'] ?? null;
    $prev_version = $entry['prev_version'] ?? null;

    if ($type === 'DELETE') {
        return [
            'type' => DEXIE_DELETE,
            'key'  => $key,
            'obj'  => null,
        ];
    }

    if ($type === 'RENAME') {
        return [
            'type' => DEXIE_RENAME,
            'key'  => $key,
            'obj'  => [
                'renamed_to'   => $entry['renamed_to'] ?? '',
                'version'      => $version,
                'prev_version' => $prev_version,
            ],
        ];
    }

    // CREATE or UPDATE — need to return current content
    $note = storage_get_note($key);
    if (!$note) return null;   // deleted between changelog write and now — skip

    $current = $note['current'] ?? null;
    $content = ($current && isset($note['versions'][$current]))
        ? $note['versions'][$current]['content']
        : '';

    $dexie_type = ($type === 'CREATE') ? DEXIE_CREATE : DEXIE_UPDATE;

    return [
        'type' => $dexie_type,
        'key'  => $key,
        'obj'  => [
            'id'           => $key,
            'content'      => $content,   // opaque — not inspected
            'version'      => $version,
            'prev_version' => $prev_version,
        ],
    ];
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) fail('Invalid JSON body');

$base_revision   = (int)($body['baseRevision']   ?? 0);
$synced_revision = (int)($body['syncedRevision'] ?? 0);
$client_changes  = $body['changes'] ?? [];
$partial         = (bool)($body['partial'] ?? false);

// The client may send partial batches (partial=true) when the number
// of pending changes exceeds a threshold. We apply each batch but
// only respond after partial=false. For simplicity we accept all
// batches and always respond — the client handles sequencing.

// ── Step 1: Apply client changes ─────────────
foreach ($client_changes as $change) {
    apply_client_change($change, $author);
}

// ── Step 2: Return server changes since syncedRevision ──
$changelog_entries = changelog_since($synced_revision);
$current_revision  = changelog_current_rev();

$server_changes = [];
$seen_keys      = [];   // deduplicate — only send latest state per key

// Process in reverse so we keep only the most recent state per key
foreach (array_reverse($changelog_entries) as $entry) {
    $key = $entry['file'] ?? '';
    if ($key === '' || isset($seen_keys[$key])) continue;
    $seen_keys[$key] = true;

    $dexie_change = changelog_entry_to_dexie_change($entry);
    if ($dexie_change !== null) {
        $server_changes[] = $dexie_change;
    }
}

// Restore chronological order for the client
$server_changes = array_reverse($server_changes);

// ── Step 3: Mark returned versions as seen by a different author ──
// If the current version of any returned note was not authored by the
// requesting user, clear its exclusive flag so the next save by the
// original author creates a new version rather than overwriting.
foreach ($server_changes as $change) {
    if ($change['type'] === DEXIE_DELETE) continue;

    $note_id = ($change['type'] === DEXIE_RENAME)
        ? ($change['obj']['renamed_to'] ?? null)
        : $change['key'];

    if ($note_id) {
        storage_mark_version_seen($note_id, $author);
    }
}

respond([
    'changes'         => $server_changes,
    'currentRevision' => $current_revision,
    'partial'         => false,
]);
