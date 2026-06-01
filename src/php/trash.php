<?php
/**
 * trash.php — soft-delete trash management endpoint
 *
 * JWT-authenticated single POST endpoint.  All actions require a valid
 * Bearer token (same as sync.php).
 *
 * Actions:
 *   action=list    → Return [{id, deleted_at, deleted_by}] for all tombstones
 *   action=restore → Revive a single note (restores full content + history)
 *   action=preview → Return tombstone content without restoring
 *   action=purge   → Hard-delete a single tombstone immediately
 *   action=empty   → Hard-delete ALL tombstones immediately
 *
 * Request body:
 *   { "action": "list" }
 *   { "action": "restore", "id": "note-id" }
 *   { "action": "purge",   "id": "note-id" }
 *   { "action": "empty" }
 *
 * Response on success:
 *   { "ok": true, "data": [...] }   for list
 *   { "ok": true, "note": {...} }   for restore
 *   { "ok": true }                  for purge / empty
 *
 * Error response:
 *   { "error": "..." }
 */

require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/auth_guard.php';
require_once __DIR__ . '/audit.php';

require_once __DIR__ . '/http-helpers.php';
require_once __DIR__ . '/cors.php';

$author = require_auth();

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    fail('Invalid JSON body');
}

$action = (string)($body['action'] ?? '');

switch ($action) {

    // ── list ─────────────────────────────────
    case 'list':
        respond([
            'ok'   => true,
            'data' => storage()->listDeletedNotes(),
        ]);

    // ── restore ──────────────────────────────
    case 'restore':
        $id = (string)($body['id'] ?? '');
        $client_id = (int)($body['client_id'] ?? 0);
        if ($id === '') {
            fail('Missing "id" parameter');
        }
        if (!storage()->noteDeleted($id)) {
            fail('Note is not deleted or tombstone not found', 404);
        }
        storage()->reviveNote($id);
        $note = storage()->getNote($id);
        if (!$note) {
            // Should not happen after revive, but be defensive
            fail('Failed to restore note', 500);
        }

        // Append changelog entry so other clients sync the revived note
        $rev = storage()->changelogNextRev();
        storage()->changelogAppend([
            'rev'          => $rev,
            'file'         => $id,
            'type'         => 'CREATE',
            'ts'           => time(),
            'version'      => $note['current'] ?? null,
            'prev_version' => null,
        ]);
        audit()->log('NOTE_RESTORE', ['user' => $author, 'note_id' => $id]);

        $n = storage()->getNoteFull($id, $client_id);
        respond([
            'ok'   => true,
            'note' => [
                'id'         => $id,
                'created_at' => $n['created_at'],
                'created_by' => $n['created_by'],
                'content'    => $n['content'],
                'current'    => $n['version'],
            ],
        ]);

    // ── preview ──────────────────────────────
    case 'preview':
        $id = (string)($body['id'] ?? '');
        if ($id === '') {
            fail('Missing "id" parameter');
        }
        $tombstone = storage()->getTombstone($id);
        if (!$tombstone) {
            fail('Tombstone not found', 404);
        }
        respond([
            'ok'   => true,
            'note' => [
                'id'         => $id,
                'content'    => $tombstone['content'],
                'created_at' => $tombstone['created_at'],
                'created_by' => $tombstone['created_by'],
                'deleted_at' => $tombstone['deleted_at'],
                'deleted_by' => $tombstone['deleted_by'],
            ],
        ]);

    // ── purge ────────────────────────────────
    case 'purge':
        $id = (string)($body['id'] ?? '');
        if ($id === '') {
            fail('Missing "id" parameter');
        }
        if (!storage()->noteDeleted($id)) {
            fail('Tombstone not found', 404);
        }
        storage()->hardDeleteNote($id);
        respond(['ok' => true]);

    // ── empty ────────────────────────────────
    case 'empty':
        $deleted = storage()->listDeletedNotes();
        foreach ($deleted as $entry) {
            storage()->hardDeleteNote($entry['id']);
        }
        respond(['ok' => true]);

    default:
        fail('Unknown action. Supported: list, restore, preview, purge, empty', 404);
}
