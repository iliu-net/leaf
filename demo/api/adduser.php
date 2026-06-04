<?php
/**
 * adduser.php — htpasswd user management tool
 *
 * Thin per-instance wrapper: loads config, blocks HTTP access, then
 * delegates to the shared implementation in src/php/adduser_impl.php.
 *
 * Run from the command line only.
 *
 * Usage:
 *   php api/adduser.php add    <username> <password>
 *   php api/adduser.php delete <username>
 *   php api/adduser.php list
 *   php api/adduser.php check  <username> <password>
 *
 * Always writes bcrypt hashes (PHP PASSWORD_BCRYPT, cost 12).
 * Compatible with Apache httpd htpasswd bcrypt entries.
 */

// Block HTTP access
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo "CLI only\n";
    exit(1);
}

require_once __DIR__ . '/config.php';
require_once LEAF_PHP_DIR. 'adduser_impl.php';
