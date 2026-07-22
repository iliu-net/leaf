<?php
/**
 * AuthGuardTest — Unit tests for auth_guard.php functions.
 *
 * Tests require_auth() and auth_username() in both the auth-enabled
 * and auth-disabled ($spa_config['auth']['enabled'] = false) paths.
 *
 * Error/exit paths of require_auth() (missing header, invalid token,
 * expired token) are exercised by the integration test suite
 * (test_auth.sh) which validates the full HTTP 401 response behaviour.
 */

use PHPUnit\Framework\TestCase;

require_once LEAF_PHP_DIR . 'http-helpers.php';
require_once LEAF_PHP_DIR . 'auth_guard.php';

class AuthGuardTest extends TestCase
{
    protected function setUp(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION']);
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $GLOBALS['spa_config'] = ['auth' => ['enabled' => true]];
    }

    /* =================================================================
       auth_username() — auth disabled
       ================================================================= */

    /**
     * When auth.enabled = false, auth_username() returns 'anonymous'
     * without checking any Authorization header.
     */
    public function testAuthUsernameReturnsAnonymousWhenDisabled(): void
    {
        $GLOBALS['spa_config']['auth']['enabled'] = false;
        $this->assertSame('anonymous', auth_username());
    }

    /**
     * When auth.enabled = false, a missing Authorization header is
     * ignored and 'anonymous' is still returned.
     */
    public function testAuthUsernameIgnoresMissingHeaderWhenDisabled(): void
    {
        $GLOBALS['spa_config']['auth']['enabled'] = false;
        unset($_SERVER['HTTP_AUTHORIZATION']);
        $this->assertSame('anonymous', auth_username());
    }

    /**
     * When auth.enabled = false, even a garbage Authorization header is
     * ignored — the function never reaches require_auth().
     */
    public function testAuthUsernameIgnoresGarbageHeaderWhenDisabled(): void
    {
        $GLOBALS['spa_config']['auth']['enabled'] = false;
        $_SERVER['HTTP_AUTHORIZATION'] = 'Not a valid header at all';
        $this->assertSame('anonymous', auth_username());
    }

    /* =================================================================
       auth_username() — auth enabled (delegates to require_auth)
       ================================================================= */

    /**
     * When auth is enabled and a valid token is present,
     * auth_username() returns the JWT 'sub' claim.
     */
    public function testAuthUsernameReturnsSubWhenEnabledAndValidToken(): void
    {
        $token = jwt_encode(['sub' => 'alice']);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        $this->assertSame('alice', auth_username());
    }

    /**
     * When $spa_config['auth'] key is entirely absent, auth_username()
     * defaults to enabled (the ?? true fallback) and requires a token.
     */
    public function testAuthUsernameDefaultsAuthKeyToEnabled(): void
    {
        $GLOBALS['spa_config'] = ['markdown' => ['html' => false]];
        $token = jwt_encode(['sub' => 'bob']);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        $this->assertSame('bob', auth_username());
    }

    /**
     * When $spa_config['auth']['enabled'] is explicitly true,
     * auth_username() requires a token and returns its subject.
     */
    public function testAuthUsernameRequiresTokenWhenExplicitlyEnabled(): void
    {
        $GLOBALS['spa_config']['auth']['enabled'] = true;
        $token = jwt_encode(['sub' => 'carol']);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        $this->assertSame('carol', auth_username());
    }

    /* =================================================================
       require_auth() — success paths
       ================================================================= */

    /**
     * require_auth() decodes a valid JWT and returns the 'sub' claim.
     */
    public function testRequireAuthReturnsUsernameForValidToken(): void
    {
        $token = jwt_encode(['sub' => 'alice']);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        $this->assertSame('alice', require_auth());
    }

    /**
     * require_auth() ignores extra claims and still returns 'sub'.
     */
    public function testRequireAuthReturnsUsernameWithExtraClaims(): void
    {
        $claims = ['sub' => 'bob', 'role' => 'admin', 'exp' => time() + 900];
        $token = jwt_encode($claims);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        $this->assertSame('bob', require_auth());
    }

    /**
     * require_auth() works with a freshly issued token.
     */
    public function testRequireAuthAcceptsTokenWithFutureExpiry(): void
    {
        $token = jwt_encode(['sub' => 'dave'], 3600);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        $this->assertSame('dave', require_auth());
    }

    /**
     * require_auth() works with an empty payload aside from 'sub'.
     * (auth_guard only checks 'sub' — small payload is fine.)
     */
    public function testRequireAuthWorksWithMinimalClaims(): void
    {
        $token = jwt_encode(['sub' => 'eve']);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
        $this->assertSame('eve', require_auth());
    }
}
