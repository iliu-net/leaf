<?php
/**
 * sync.php — Dexie Syncable server endpoint (poll pattern)
 *
 * Implements the ISyncProtocol server side for Dexie Syncable.
 * Uses the poll pattern — suitable for shared hosting where WebSockets
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
 *   The client receives the competing version in the response and Dexie
 *   applies its own last-write-wins resolution on the client side.
 *   Old versions are preserved for future 3-way merge UI.
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

// CORS — tighten Access-Control-Allow-Origin in production
header('Access-Control-Allow-Origin: *');
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
 * @param array  $change  Dexie change object with keys: type, key, obj
 * @param string $author  Authenticated username applying the change
 * @return array|null     Changelog entry written, or null if skipped
 */
function apply_client_change(array $change, string $author): ?array {
    $type = (int)($change['type'] ?? 0);
    $key  = safe_id((string)($change['key'] ?? ''));
    $obj  = $change['obj'] ?? null;   // null for DELETE

    if ($key === '') return null;

    // ── CREATE or UPDATE ──────────────────────
    if ($type === DEXIE_CREATE || $type === DEXIE_UPDATE) {
        $content = (string)($obj['content'] ?? '');

        if (note_is_deleted($key)) {
            // Note was deleted on server — skip silently.
            // The client will receive the DELETE in the response and reconcile.
            return null;
        }

        $is_new = !storage_note_exists($key);

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

    return null;   // unknown type — skip
}

// ─────────────────────────────────────────────
// Build server changes response
// ─────────────────────────────────────────────

/**
 * Convert a changelog entry into a Dexie change object.
 *
 * Returns null if the note file cannot be read (e.g. race condition
 * where a note was deleted between the changelog write and this read).
 *
 * @param array $entry  Changelog entry with keys: file, type, version, prev_version
 * @return array{type: int, key: string, obj: array|null}|null  Dexie change object
 */
function changelog_entry_to_dexie_change(array $entry): ?array {
    $key  = $entry['file'] ?? '';
    $type = $entry['type'] ?? '';

    if ($type === 'DELETE') {
        return [
            'type' => DEXIE_DELETE,
            'key'  => $key,
            'obj'  => null,
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
            'id'      => $key,
            'content' => $content,   // opaque — not inspected
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

// Dexie sends partial batches when partialsThreshold is exceeded.
// We apply each batch but only respond after partial=false.
// For simplicity we accept all batches and always respond — Dexie
// handles the sequencing on the client side.

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

respond([
    'changes'         => $server_changes,
    'currentRevision' => $current_revision,
    'partial'         => false,
]);
