<?php
/**
 * spa-config.php — expose $spa_config to the SPA client
 *
 * Returns the $spa_config array (defined in config.php) as JSON.
 * Degrades gracefully to {} if $spa_config is not defined, so
 * existing deployments without the array continue to work.
 *
 * Called by router.php for GET /api/index.php/spa-config.
 */

require_once __DIR__ . '/http-helpers.php';
header('Access-Control-Allow-Methods: GET, OPTIONS');
require_once __DIR__ . '/cors.php';

// ── Server version info ──────────────────────────────────────────

$versionFile = __DIR__ . '/version.txt';
$serverVersion = is_file($versionFile)
    ? trim(file_get_contents($versionFile))
    : 'unknown';

$spa_config['_server'] = [
    'version' => $serverVersion,
    'php'     => PHP_VERSION,
];

respond($spa_config ?? (object)[]);
