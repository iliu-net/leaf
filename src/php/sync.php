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
 *     "syncedRevision": 15,      // last revision client has seen from server
 *     "changes": [               // local changes to apply (may be empty)
 *       {
 *         "type": 1|2|3,         // 1=CREATE 2=UPDATE 3=DELETE
 *         "key":  "note-id",
 *         "obj":  {              // minimal for DELETE: {"deleted_by": "alice"}
 *           "id":        "note-id",
 *           "content":   "<opaque>",
 *           "version":   "2026-05-27:1:alice",
 *           "author":    "alice",
 *           "created_by": "bob",
 *           "created_at": 1748000000,
 *           "updated_at": 1748340000
 *         }
 *       }
 *     ],
 *   }
 *
 *   Response body:
 *   {
 *     "changes":         [...],  // server changes since syncedRevision
 *     "currentRevision": 18,     // server's current revision after applying changes
 *   }
 *
 * Conflict strategy: last-write-wins at the version level.
 *   The server always accepts incoming changes. If a competing change has
 *   already been written, both survive as
 *   separate version history entries linked by the prev pointer chain.
 *   The client receives the competing version in the response and reconciles
 *   locally. Old versions are preserved for future 3-way merge UI.
 *
 * Content opacity:
 *   obj.content is stored and returned as-is. sync.php never reads it.
 *   This makes E2EE a pure client-side addition with no server changes.
 *
 */

require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/auth_guard.php';
require_once __DIR__ . '/audit.php';

// ── Dexie change type constants ────────────────────────────────────────────

const DEXIE_CREATE = 1;
const DEXIE_UPDATE = 2;
const DEXIE_DELETE = 3;
const DEXIE_RENAME = 4;

require_once __DIR__ . '/http-helpers.php';
require_once __DIR__ . '/cors.php';

$author = auth_username();   // 'anonymous' when auth disabled, 401 otherwise

// ── Daily house keeping chores ──────────
$purgeFile = DATA_ROOT . 'last_purge.txt';
$lastPurge = file_exists($purgeFile) ? (int)file_get_contents($purgeFile) : 0;
if (time() - $lastPurge > 86400) {
    storage()->housekeeping('sync');
    audit()->purge('sync');
    file_put_contents($purgeFile, (string)time());
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
    return preg_replace('/[^a-zA-Z0-9_\-\.$%\'@~!(){}^#&`: +,;=\[\] ]/u', '_', $raw);
}

// ─────────────────────────────────────────────
// Apply client changes
// ─────────────────────────────────────────────

/**
 * Apply a single client change to storage and write a changelog entry.
 *
 * @param array  $change  Change object with keys: type, key, obj
 * @param string $author  Authenticated username applying the change
 * @param int $client_id sync client ID of current user
 */
function apply_client_change(array $change, string $author, int $client_id) {
    $type = (int)($change['type'] ?? 0);
    $key  = safe_id((string)($change['key'] ?? ''));
    $obj  = $change['obj'] ?? null;   // null for DELETE

    if ($key === '') return;

    // ── CREATE or UPDATE ──────────────────────
    if ($type === DEXIE_CREATE || $type === DEXIE_UPDATE) {
        $vkey = storage()->putNoteLogged(
            $key, (string)($obj['content'] ?? ''), $author, $client_id,
            $obj['version'] ?? ''
        );
        if ($vkey) {
	    list($version, $dirty) = $vkey;
	    $audit = [
                'user' => $author, 'note_id' => $key,
                'version' => $version,
	    ];
	    if ($dirty) { $audit['dirty'] = true; }
            audit()->log('NOTE_WRITE', $audit);
        }
        return;
    }

    // ── DELETE ────────────────────────────────
    if ($type === DEXIE_DELETE) {
        $ret = storage()->deleteNoteLogged($key, $author);
        if ($ret) {
            audit()->log('NOTE_DELETE', ['user' => $author, 'note_id' => $key]);
        }
        return;
    }

    // ── RENAME ────────────────────────────────
    if ($type === DEXIE_RENAME) {
        $new_id = safe_id($obj['renamed_to'] ?? '');
        $ret = storage()->renameNoteLogged($key, $new_id, $author);
        if ($ret) {
            audit()->log('NOTE_RENAME', ['user' => $author, 'note_id' => $key, 'renamed_to' => $new_id]);
        }
        return;
    }

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
 * @param int $client_id sync client ID of current user
 * @return array{type: int, key: string, obj: array|null}|null  Change object for response
 */
function changelog_entry_to_dexie_change(array $entry, int $client_id): ?array {
    $key  = $entry['file'] ?? '';
    $type = $entry['type'] ?? '';

    $version      = $entry['version'] ?? null;
    $prev_version = $entry['prev_version'] ?? null;

    if ($type === 'DELETE') {
        return [
            'type' => DEXIE_DELETE,
            'key'  => $key,
            'obj'  => [
                'deleted_by' => $entry['deleted_by'] ?? '',
                'deleted_at' => $entry['ts']        ?? 0,
            ],
        ];
    }

    if ($type === 'RENAME') {
        return [
            'type' => DEXIE_RENAME,
            'key'  => $key,
            'obj'  => [
                'renamed_to'   => $entry['renamed_to'] ?? '',
                'renamed_by'   => $entry['renamed_by'] ?? '',
                'renamed_at'   => $entry['ts']         ?? 0,
                'version'      => $version,
                'prev_version' => $prev_version,
            ],
        ];
    }

    // CREATE or UPDATE — need to return current content
    $n = storage()->getNoteFull($key, $client_id);
    if (!$n) return null;   // deleted between changelog write and now — skip

    $dexie_type = ($type === 'CREATE') ? DEXIE_CREATE : DEXIE_UPDATE;

    return [
        'type' => $dexie_type,
        'key'  => $key,
        'obj'  => [
            'content'      => $n['content'],
            'version'      => $version,
            'prev_version' => $prev_version,
            'author'       => $n['author'],
            'created_by'   => $n['created_by'],
            'created_at'   => $n['created_at'],
            'updated_at'   => $n['updated_at'],
        ],
    ];
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) fail('Invalid JSON body');

$synced_revision = (int)($body['syncedRevision'] ?? 0);
$client_changes  = $body['changes'] ?? [];
$client_id      = (int)($body['client_id'] ?? 0);

// ── Step 0: Validate all client change IDs before applying any ──
// If any key would be transformed by safe_id(), the client has a bug —
// reject the whole batch rather than silently rewriting.
foreach ($client_changes as $change) {
    $raw_key = (string)($change['key'] ?? '');
    $safe    = safe_id($raw_key);
    if ($raw_key !== '' && $safe !== $raw_key) {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode([
            'error'    => 'INVALID_ID',
            'key'      => $raw_key,
            'expected' => $safe,
        ]);
        exit;
    }
    // Also validate renamed_to for RENAME changes
    $type = (int)($change['type'] ?? 0);
    if ($type === DEXIE_RENAME) {
        $raw_new  = (string)($change['obj']['renamed_to'] ?? '');
        $safe_new = safe_id($raw_new);
        if ($raw_new !== '' && $safe_new !== $raw_new) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode([
                'error'    => 'INVALID_ID',
                'key'      => $raw_new,
                'expected' => $safe_new,
            ]);
            exit;
        }
    }
}

// ── Step 1: Apply client changes ─────────────
foreach ($client_changes as $change) {
    apply_client_change($change, $author, $client_id);
}

// ── Step 2: Return server changes since syncedRevision ──
//
// Three branches:
//   syncedRevision === 0  →  Bootstrap: build response from filesystem.
//                             Avoids scanning the entire changelog for new clients.
//   syncedRevision  > 0
//     && syncedRevision < earliest_rev  →  Stale: client's revision predates the
//                             surviving changelog (it was truncated).  Return 409
//                             so the client knows to restart from scratch.
//   syncedRevision >= earliest_rev  →  Incremental: walk changelog entries since
//                             the client's last sync and deduplicate by key.

$current_revision = storage()->changelogCurrentRev();
$server_changes   = [];

//~ error_log("SYNC: current_rev:${current_revision} synced_rev:${synced_revision}");

if ($synced_revision === 0) {
    // ── Bootstrap: build from filesystem ────────

    // Live notes → CREATE changes
    foreach (storage()->listNotes() as $meta) {
        $n = storage()->getNoteFull($meta['id'], $client_id);
        if (!$n) continue;

        $server_changes[] = [
            'type' => DEXIE_CREATE,
            'key'  => $meta['id'],
            'obj'  => [
                'content'      => $n['content'],
                'version'      => $n['version'],
                'prev_version' => $n['prev'],
                'author'       => $n['author'],
                'created_by'   => $n['created_by'],
                'created_at'   => $n['created_at'],
                'updated_at'   => $n['updated_at'],
            ],
        ];
    }

    // Tombstones → DELETE changes
    foreach (storage()->listDeletedNotes() as $tombstone) {
        $server_changes[] = [
            'type' => DEXIE_DELETE,
            'key'  => $tombstone['id'],
            'obj'  => [
                'deleted_by' => $tombstone['deleted_by'] ?? '',
                'deleted_at' => $tombstone['deleted_at'] ?? 0,
            ],
        ];
    }

} else {
    $earliest_rev = storage()->changelogEarliestRev();

    if ($synced_revision < $earliest_rev) {
        http_response_code(409);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'STALE_REVISION']);
        exit;
    }

    // ── Incremental: use changelog ──────────────

    $changelog_entries = storage()->changelogSince($synced_revision);
    $seen_keys = [];

    // Process in reverse so we keep only the most recent state per key
    foreach (array_reverse($changelog_entries) as $entry) {
        $key = $entry['file'] ?? '';
        if ($key === '' || isset($seen_keys[$key])) continue;
        $seen_keys[$key] = true;

        $dexie_change = changelog_entry_to_dexie_change($entry, $client_id);
        if ($dexie_change !== null) {
            $server_changes[] = $dexie_change;
        }
    }

    // Restore chronological order for the client
    $server_changes = array_reverse($server_changes);
}

// ── Step 3: Mark returned versions as seen by a different author ──
// If the current version of any returned note was not authored by the
// requesting user, clear its exclusive flag so the next save by the
// original author creates a new version rather than overwriting.
foreach ($server_changes as $change) {
    if ($change['type'] === DEXIE_DELETE) continue;

    $note_id = ($change['type'] === DEXIE_RENAME)
        ? ($change['obj']['renamed_to'] ?? null)
        : $change['key'];

    // Log every note whose content is delivered to the client (CREATE/UPDATE)
    // RENAME does not deliver content, so it is excluded from NOTE_READ.
    if ($change['type'] === DEXIE_CREATE || $change['type'] === DEXIE_UPDATE) {
        audit()->log('NOTE_READ', [
            'user'    => $author,
            'note_id' => $note_id,
            'version' => $change['obj']['version'] ?? null,
        ]);
    }

    if ($note_id) {
        storage()->markVersionSeen($note_id, $client_id);
    }
}

respond([
    'changes'         => $server_changes,
    'currentRevision' => $current_revision,
]);
