<?php
/**
 * adduser.php — htpasswd user management tool
 *
 * Run from the command line only — exits immediately if called via HTTP.
 *
 * Usage:
 *   php adduser.php add    <username> <password>   Add or update a user
 *   php adduser.php delete <username>              Remove a user
 *   php adduser.php list                           List all usernames
 *   php adduser.php check  <username> <password>   Test a password
 *
 * Always writes bcrypt hashes (PHP PASSWORD_BCRYPT, cost 12).
 * Compatible with Apache httpd htpasswd bcrypt entries.
 *
 * Example:
 *   php adduser.php add alice hunter2
 *   php adduser.php add bob   s3cr3t
 *   php adduser.php list
 */

// Block HTTP access
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo "CLI only\n";
    exit(1);
}

require_once __DIR__ . '/config.php';

// ── Helpers ───────────────────────────────────────────────────────────────

function load_htpasswd(): array {
    if (!file_exists(HTPASSWD_FILE)) return [];
    $lines = file(HTPASSWD_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    $users = [];
    foreach ($lines as $line) {
        if (str_starts_with(ltrim($line), '#')) continue;
        $colon = strpos($line, ':');
        if ($colon === false) continue;
        $users[substr($line, 0, $colon)] = substr($line, $colon + 1);
    }
    return $users;
}

function save_htpasswd(array $users): void {
    $lines  = ["# htpasswd — managed by adduser.php — do not edit manually\n"];
    foreach ($users as $user => $hash) {
        $lines[] = "$user:$hash\n";
    }
    $tmp = HTPASSWD_FILE . '.tmp.' . getmypid();
    file_put_contents($tmp, implode('', $lines));
    rename($tmp, HTPASSWD_FILE);
}

function abort(string $msg, int $code = 1): never {
    fwrite(STDERR, "Error: $msg\n");
    exit($code);
}

function usage(): never {
    echo "Usage:\n";
    echo "  php adduser.php add    <username> <password>\n";
    echo "  php adduser.php delete <username>\n";
    echo "  php adduser.php list\n";
    echo "  php adduser.php check  <username> <password>\n";
    exit(0);
}

// ── Validation ────────────────────────────────────────────────────────────

function valid_username(string $u): bool {
    // No colons (htpasswd delimiter), no path chars, reasonable length
    return $u !== '' && strlen($u) <= 64 && !preg_match('/[:\\/\\\\]/', $u);
}

// ── Commands ──────────────────────────────────────────────────────────────

$cmd = $argv[1] ?? '';

if ($cmd === 'add') {
    $username = $argv[2] ?? '';
    $password = $argv[3] ?? '';

    if (!valid_username($username)) abort("Invalid username '$username'");
    if (strlen($password) < 8)     abort("Password must be at least 8 characters");

    $users          = load_htpasswd();
    $action         = isset($users[$username]) ? 'Updated' : 'Added';
    $users[$username] = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    save_htpasswd($users);

    echo "$action user: $username\n";
    exit(0);
}

if ($cmd === 'delete') {
    $username = $argv[2] ?? '';
    if ($username === '') usage();

    $users = load_htpasswd();
    if (!isset($users[$username])) abort("User '$username' not found");

    unset($users[$username]);
    save_htpasswd($users);

    echo "Deleted user: $username\n";
    exit(0);
}

if ($cmd === 'list') {
    $users = load_htpasswd();
    if (empty($users)) {
        echo "No users found in " . HTPASSWD_FILE . "\n";
    } else {
        echo "Users in " . HTPASSWD_FILE . ":\n";
        foreach (array_keys($users) as $u) echo "  $u\n";
    }
    exit(0);
}

if ($cmd === 'check') {
    $username = $argv[2] ?? '';
    $password = $argv[3] ?? '';
    if ($username === '' || $password === '') usage();

    require_once __DIR__ . '/users.php';
    $result = validate_user($username, $password);
    if ($result !== false) {
        echo "OK: password valid for '$username'\n";
        exit(0);
    } else {
        echo "FAIL: invalid username or password\n";
        exit(1);
    }
}

usage();
