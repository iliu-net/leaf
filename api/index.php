<?php
/**
 * index.php — single entry point for all API requests
 *
 * Loads the per-instance configuration, determines the shared code
 * directory, then delegates to the shared router.
 *
 * This file is the only PHP file that differs per instance (besides
 * config.php).  All request handling logic lives in src/php/.
 */

require_once __DIR__ . '/config.php';

$sharedDir = dirname(__DIR__) . '/src/php/';

require $sharedDir . 'router.php';
