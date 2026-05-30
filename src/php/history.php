<?php
/**
 * history.php — version history endpoint
 *
 * JWT-authenticated POST endpoint. Returns the version chain for a note
 * and fetches opaque content for specific versions (for diffing).
 *
 * Actions:
 *   action=list  → Return version metadata (no content)
 *   action=get   → Return content for specified version keys
 *
 * Request body:
 *   { "action": "list", "id": "note-id" }
 *   { "action": "get",  "id": "note-id", "versions": ["key1", "key2"] }
 *
 * Response on success:
 *   { "ok": true, "current": "...", "versions": [...] }   for list
 *   { "ok": true, "contents": { "key1": "...", ... } }    for get
 *
 * Error response:
 *   { "error": "..." }
 */

require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/auth_guard.php';

require_once __DIR__ . '/http-helpers.php';
require_once __DIR__ . '/cors.php';

$author = require_auth();   // exits with 401 if token missing/invalid

// ── Parse request ─────────────────────────────────────────────────────────────

$body   = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) fail('Invalid JSON body');

$action = $body['action'] ?? '';
$id     = $body['id']     ?? '';

if ($id === '') fail('Missing note id');

// ── action=list ───────────────────────────────────────────────────────────────

if ($action === 'list') {
    $note = storage_get_note($id);
    if (!$note) {
        // Note doesn't exist or is deleted — return empty list
        respond(['ok' => true, 'current' => null, 'versions' => []]);
    }

    $result = storage_get_version_list($id);

    respond([
        'ok'       => true,
        'current'  => $note['current'] ?? null,
        'versions' => $result,
    ]);
}

// ── action=get ────────────────────────────────────────────────────────────────

if ($action === 'get') {
    $requested_versions = $body['versions'] ?? [];
    if (!is_array($requested_versions)) fail('versions must be an array');

    $note = storage_get_note($id);
    if (!$note) fail('Note not found', 404);

    $contents = [];
    foreach ($requested_versions as $vkey) {
        $contents[$vkey] = storage_get_version_content($id, $vkey);
    }

    respond([
        'ok'       => true,
        'contents' => $contents,
    ]);
}

// ── Unknown action ────────────────────────────────────────────────────────────

fail('Unknown action: ' . $action, 404);
