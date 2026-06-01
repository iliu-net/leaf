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
define('INDEX_PHP_DIR', __DIR__.'/');

require_once INDEX_PHP_DIR . 'config.php';
require LEAF_PHP_DIR . 'router.php';
