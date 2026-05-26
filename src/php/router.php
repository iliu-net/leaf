<?php
/**
 * router.php — request dispatcher
 *
 * Determines the endpoint from the request URL and dispatches to the
 * matching handler.  Called by api/index.php after config is loaded and
 * $sharedDir is set.
 *
 * Expects $sharedDir to be defined (the absolute path to src/php/).
 *
 * URL patterns (both work):
 *   Clean:    api/auth?action=login          (Apache mod_dir + AcceptPathInfo)
 *   Explicit: api/index.php/auth?action=login  (any server)
 *
 * PATH_INFO is the primary routing mechanism.  A REQUEST_URI-based
 * fallback handles servers where PATH_INFO is unset.
 */

// ── Determine the endpoint ───────────────────────────────────────────────────

$endpoint = '';

// Primary: PATH_INFO
//   Clean URL:    /api/auth        →  PATH_INFO = /auth
//   Explicit URL: /api/index.php/auth  →  PATH_INFO = /auth
$pathInfo = $_SERVER['PATH_INFO'] ?? '';

if ($pathInfo !== '') {
    $endpoint = ltrim($pathInfo, '/');
} else {
    // Fallback: parse from REQUEST_URI relative to SCRIPT_NAME
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
    $requestUri = $_SERVER['REQUEST_URI'] ?? '';

    // Strip query string
    $qpos = strpos($requestUri, '?');
    $pathOnly = $qpos !== false ? substr($requestUri, 0, $qpos) : $requestUri;

    if (!str_ends_with($pathOnly, '.php')) {
        $endpoint = substr($pathOnly, strlen($scriptName));
        $endpoint = ltrim($endpoint, '/');
    }
}

// ── Route to handler ─────────────────────────────────────────────────────────

$parts = explode('/', $endpoint, 2);
$route = $parts[0] ?? '';

switch ($route) {
    case 'auth':
        require $sharedDir . 'auth.php';
        break;
    case 'sync':
        require $sharedDir . 'sync.php';
        break;
    case 'trash':
        require $sharedDir . 'trash.php';
        break;
    default:
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Endpoint not found']);
        break;
}
