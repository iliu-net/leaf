<?php
/**
 * spacfg_impl.php — print the SPA config as JSON, or show the data directory
 *
 * Usage:
 *   php api/index.php spacfg            Print $spa_config as pretty JSON
 *   php api/index.php spacfg --data     Print DATA_ROOT as a plain string
 *
 * Examples:
 *   php api/index.php spacfg
 *   php api/index.php spacfg --data
 */

$arg = $argv[2] ?? '';

if ($arg === '--data') {
    echo DATA_ROOT . "\n";
    exit(0);
}

if ($arg !== '' && $arg !== '--help' && $arg !== '-h') {
    fwrite(STDERR, "Unknown option: {$arg}\n");
    fwrite(STDERR, "Usage: php api/index.php spacfg [--data]\n");
    exit(1);
}

header('Content-Type: application/json');
echo json_encode($GLOBALS['spa_config'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
