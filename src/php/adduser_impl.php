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

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Load the htpasswd file and return a map of username => bcrypt hash.
 *
 * Skips comment lines (starting with #) and malformed lines.
 *
 * @return array<string, string>  Associative array of username => hash
 */
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

/**
 * Persist the user map to the htpasswd file atomically (temp file + rename).
 *
 * Writes a header comment, then one username:hash line per user.
 *
 * @param array<string, string> $users  Associative array of username => hash
 * @return void
 */
function save_htpasswd(array $users): void {
    $lines  = ["# htpasswd — managed by adduser.php — do not edit manually\n"];
    foreach ($users as $user => $hash) {
        $lines[] = "$user:$hash\n";
    }
    $tmp = HTPASSWD_FILE . '.tmp.' . getmypid();
    file_put_contents($tmp, implode('', $lines));
    rename($tmp, HTPASSWD_FILE);
}

/**
 * Print an error message to STDERR and exit with the given code.
 *
 * @param string $msg   Error message
 * @param int    $code  Exit status code (default 1)
 * @return never
 */
function abort(string $msg, int $code = 1): never {
    fwrite(STDERR, "Error: $msg\n");
    exit($code);
}

/**
 * Print CLI usage instructions and exit.
 *
 * @return never
 */
function usage(): never {
    echo "Usage:\n";
    echo "  php adduser.php add    <username> <password>\n";
    echo "  php adduser.php delete <username>\n";
    echo "  php adduser.php list\n";
    echo "  php adduser.php check  <username> <password>\n";
    exit(0);
}

// ── Validation ────────────────────────────────────────────────────────────

/**
 * Validate a username string.
 *
 * Usernames must be non-empty, at most 64 characters, and must not
 * contain colons (htpasswd delimiter) or path separator characters.
 *
 * @param string $u  Username to validate
 * @return bool      True if the username is valid
 */
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
