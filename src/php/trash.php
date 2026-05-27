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

header('Access-Control-Allow-Origin: ' . CORS_ALLOW_POLICY);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST required']);
    exit;
}

$author = require_auth();

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$action = (string)($body['action'] ?? '');

switch ($action) {

    // ── list ─────────────────────────────────
    case 'list':
        echo json_encode([
            'ok'   => true,
            'data' => storage_list_deleted_notes(),
        ], JSON_UNESCAPED_UNICODE);
        exit;

    // ── restore ──────────────────────────────
    case 'restore':
        $id = (string)($body['id'] ?? '');
        if ($id === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Missing "id" parameter']);
            exit;
        }
        if (!note_is_deleted($id)) {
            http_response_code(404);
            echo json_encode(['error' => 'Note is not deleted or tombstone not found']);
            exit;
        }
        storage_revive_note($id);
        $note = storage_get_note($id);
        if (!$note) {
            // Should not happen after revive, but be defensive
            http_response_code(500);
            echo json_encode(['error' => 'Failed to restore note']);
            exit;
        }

        // Append changelog entry so other clients sync the revived note
        $rev = next_rev();
        changelog_append([
            'rev'          => $rev,
            'file'         => $id,
            'type'         => 'CREATE',
            'ts'           => time(),
            'version'      => $note['current'] ?? null,
            'prev_version' => null,
        ]);
        audit_log('NOTE_RESTORE', ['user' => $author, 'note_id' => $id]);

        $current = $note['current'] ?? null;
        echo json_encode([
            'ok'   => true,
            'note' => [
                'id'         => $id,
                'created_at' => $note['created_at'] ?? 0,
                'created_by' => $note['created_by'] ?? '',
                'content'    => ($current && isset($note['versions'][$current]))
                    ? $note['versions'][$current]['content']
                    : '',
                'current'    => $current,
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;

    // ── preview ──────────────────────────────
    case 'preview':
        $id = (string)($body['id'] ?? '');
        if ($id === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Missing "id" parameter']);
            exit;
        }
        $deletedPath = deleted_path($id);
        if (!file_exists($deletedPath)) {
            http_response_code(404);
            echo json_encode(['error' => 'Tombstone not found']);
            exit;
        }
        $data = json_decode(file_get_contents($deletedPath), true);
        $current = $data['current'] ?? null;
        $content = ($current && isset($data['versions'][$current]))
            ? $data['versions'][$current]['content']
            : '';
        echo json_encode([
            'ok'   => true,
            'note' => [
                'id'         => $id,
                'content'    => $content,
                'created_at' => $data['created_at'] ?? 0,
                'created_by' => $data['created_by'] ?? '',
                'deleted_at' => $data['deleted_at'] ?? 0,
                'deleted_by' => $data['deleted_by'] ?? '',
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;

    // ── purge ────────────────────────────────
    case 'purge':
        $id = (string)($body['id'] ?? '');
        if ($id === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Missing "id" parameter']);
            exit;
        }
        if (!note_is_deleted($id)) {
            http_response_code(404);
            echo json_encode(['error' => 'Tombstone not found']);
            exit;
        }
        storage_hard_delete_note($id);
        echo json_encode(['ok' => true]);
        exit;

    // ── empty ────────────────────────────────
    case 'empty':
        $deleted = storage_list_deleted_notes();
        foreach ($deleted as $entry) {
            storage_hard_delete_note($entry['id']);
        }
        echo json_encode(['ok' => true]);
        exit;

    default:
        http_response_code(404);
        echo json_encode(['error' => 'Unknown action. Supported: list, restore, preview, purge, empty']);
        exit;
}
