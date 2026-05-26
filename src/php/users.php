<?php
/**
 * users.php — user validation
 *
 * Exposes a single function: validate_user(username, password)
 * Returns the username string on success, false on failure.
 *
 * Current implementation: Apache htpasswd flat file with bcrypt hashes.
 *
 * To switch to a different backend later (database, LDAP, OAuth):
 *   - Replace the body of validate_user() only.
 *   - The rest of the auth layer is untouched.
 *
 * htpasswd file format (bcrypt entries only):
 *   alice:$2y$10$...hashedpassword...
 *   bob:$2y$10$...hashedpassword...
 *
 * To add/update users use adduser.php (CLI tool).
 *
 * Note: MD5 and SHA1 htpasswd formats are NOT supported here by design —
 * bcrypt only. adduser.php always writes bcrypt entries.
 */

/**
 * Validate a username and password against the htpasswd file.
 *
 * @param  string        $username
 * @param  string        $password  Plain-text password to verify
 * @return string|false             Username on success, false on failure
 */
function validate_user(string $username, string $password): string|false {
    // Basic sanity — usernames must not contain colons (htpasswd format uses : as delimiter)
    if ($username === '' || $password === '' || str_contains($username, ':')) {
        return false;
    }

    if (!file_exists(HTPASSWD_FILE)) {
        error_log('[users] htpasswd file not found: ' . HTPASSWD_FILE);
        return false;
    }

    $lines = file(HTPASSWD_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return false;

    foreach ($lines as $line) {
        // Skip comments
        if (str_starts_with(ltrim($line), '#')) continue;

        $colon = strpos($line, ':');
        if ($colon === false) continue;

        $file_user = substr($line, 0, $colon);
        $file_hash = substr($line, $colon + 1);

        // Case-sensitive username match
        if ($file_user !== $username) continue;

        // Only bcrypt hashes ($2y$ prefix) are accepted
        if (!str_starts_with($file_hash, '$2y$') && !str_starts_with($file_hash, '$2a$')) {
            error_log("[users] Non-bcrypt hash for user '$username' — rejected");
            return false;
        }

        if (password_verify($password, $file_hash)) {
            return $username;
        }

        return false;   // Username found but password wrong
    }

    return false;   // Username not found
}
