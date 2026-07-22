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
if (PHP_SAPI === 'cli') {
  if (count($argv) < 2) {
    showCliUsage(0);
  }
  if (file_exists(__DIR__.'/'.$argv[1].'_impl.php')) {
    require_once __DIR__.'/'.$argv[1].'_impl.php';
  } else {
    fwrite(STDERR, "Unknown subcommand: {$argv[1]}\n\n");
    showCliUsage(1);
  }
  exit(0);
}

/**
 * Extract a one-line description from an _impl.php file's docblock.
 *
 * Looks for the first /** … * / block and returns the first text line
 * after stripping the "filename — " prefix convention.
 */
function cliDescription(string $file): string {
    $content = file_get_contents($file);
    if (preg_match('|/\*\*\s*\n\s*\*\s*(.*)|', $content, $m)) {
        $desc = trim($m[1]);
        // Strip "filename.php — " or "filename.php - " prefix
        $desc = preg_replace('/^[a-z0-9_-]+\.php\s*[—\-]\s*/i', '', $desc);
        return $desc;
    }
    return '';
}

/**
 * Print available CLI subcommands with descriptions and exit.
 *
 * Scans src/php/ for *_impl.php files, extracts a one-line description
 * from each docblock, and lists them.
 */
function showCliUsage(int $code): never {
    $impls = glob(__DIR__.'/*_impl.php') ?: [];
    $subs  = [];
    foreach ($impls as $f) {
        $subs[basename($f, '_impl.php')] = cliDescription($f);
    }
    ksort($subs);

    if ($subs) {
        echo "Available subcommands:\n";
        $pad = max(array_map('strlen', array_keys($subs))) + 2;
        foreach ($subs as $name => $desc) {
            printf("  %-{$pad}s%s\n", $name, $desc);
        }
    } else {
        echo "No subcommands available.\n";
    }
    echo "\nUsage: php api/index.php <subcommand> [options]\n";
    exit($code);
}


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
        require LEAF_PHP_DIR . 'auth.php';
        break;
    case 'sync':
        require LEAF_PHP_DIR . 'sync.php';
        break;
    case 'trash':
        require LEAF_PHP_DIR . 'trash.php';
        break;
    case 'history':
        require LEAF_PHP_DIR . 'history.php';
        break;
    case 'spa-config':
        require LEAF_PHP_DIR . 'spa-config.php';
        break;
    default:
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Endpoint not found']);
        break;
}
