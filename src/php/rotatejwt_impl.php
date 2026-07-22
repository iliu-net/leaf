<?php
/**
 * rotatejwt_impl.php — regenerate the JWT_SECRET for this instance
 *
 * Usage:
 *   php api/index.php rotatejwt
 *
 * Generates a fresh 64-character hex secret and updates the
 * define('JWT_SECRET', ...) line in the instance's config.php.
 *
 * ⚠  This invalidates all existing sessions — existing refresh tokens
 * and JWTs were signed with the old secret and will be rejected.
 * Delete refresh_tokens.json for a clean slate:
 *   rm <DATA_ROOT>/refresh_tokens.json
 */

$configPath = INDEX_PHP_DIR . 'config.php';

if (!is_writable($configPath)) {
    fwrite(STDERR, "Error: config.php is not writable: {$configPath}\n");
    exit(1);
}

$secret = bin2hex(random_bytes(32));

$config = file_get_contents($configPath);
$count  = 0;
$config = preg_replace(
    "/^([ \t]*define\('JWT_SECRET',[ \t]*)'[^']*'/m",
    "\$1'{$secret}'",
    $config,
    -1,
    $count
);

if ($count === 0) {
    fwrite(STDERR, "Error: could not find JWT_SECRET definition in {$configPath}\n");
    exit(1);
}

file_put_contents($configPath, $config);

echo "JWT_SECRET rotated in {$configPath}\n";
echo "  New secret: " . substr($secret, 0, 8) . "…" . substr($secret, -8) . "\n";
echo "\n";
echo "  ⚠  All existing sessions are now invalid.\n";
echo "  Delete refresh_tokens.json for a clean slate:\n";
echo "    rm " . DATA_ROOT . "refresh_tokens.json\n";
