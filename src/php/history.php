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

$author = require_auth();   // exits with 401 if token missing/invalid

// ── Helpers ───────────────────────────────────────────────────────────────────

function respond(mixed $data): never {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

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

    $versions = $note['versions'] ?? [];
    $current  = $note['current']  ?? null;

    $result = [];
    foreach ($versions as $vkey => $ventry) {
        $author = $ventry['author'] ?? '';
        // Fall back to parsing the key for old notes that lack the author field
        if ($author === '') {
            $parts  = explode(':', $vkey, 3);
            $author = $parts[2] ?? '';
        }
        $result[] = [
            'key'      => $vkey,
            'author'   => $author,
            'saved_at' => $ventry['saved_at'] ?? 0,
            'prev'     => $ventry['prev']     ?? null,
        ];
    }

    // Sort by saved_at descending (most recent first)
    usort($result, fn($a, $b) => $b['saved_at'] <=> $a['saved_at']);

    respond([
        'ok'       => true,
        'current'  => $current,
        'versions' => $result,
    ]);
}

// ── action=get ────────────────────────────────────────────────────────────────

if ($action === 'get') {
    $requested_versions = $body['versions'] ?? [];
    if (!is_array($requested_versions)) fail('versions must be an array');

    $note = storage_get_note($id);
    if (!$note) fail('Note not found', 404);

    $note_versions = $note['versions'] ?? [];
    $contents = [];

    foreach ($requested_versions as $vkey) {
        if (isset($note_versions[$vkey])) {
            $contents[$vkey] = $note_versions[$vkey]['content'] ?? '';
        } else {
            $contents[$vkey] = null;
        }
    }

    respond([
        'ok'       => true,
        'contents' => $contents,
    ]);
}

// ── Unknown action ────────────────────────────────────────────────────────────

fail('Unknown action: ' . $action, 404);
