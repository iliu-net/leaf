<?php
use PHPUnit\Framework\TestCase;

class UsersTest extends TestCase
{
    protected function setUp(): void
    {
        @unlink(HTPASSWD_FILE);
    }

    protected function tearDown(): void
    {
        @unlink(HTPASSWD_FILE);
    }

    private function writeHtpasswd(array $users): void
    {
        $lines = ["# test htpasswd\n"];
        foreach ($users as $user => $pass) {
            $lines[] = "$user:" . password_hash($pass, PASSWORD_BCRYPT, ['cost' => 4]) . "\n";
        }
        file_put_contents(HTPASSWD_FILE, implode('', $lines));
    }

    public function testValidCredentials(): void
    {
        $this->writeHtpasswd(['alice' => 'secret123']);
        $result = validate_user('alice', 'secret123');
        $this->assertSame('alice', $result);
    }

    public function testWrongPassword(): void
    {
        $this->writeHtpasswd(['alice' => 'secret123']);
        $this->assertFalse(validate_user('alice', 'wrongpass'));
    }

    public function testUnknownUser(): void
    {
        $this->writeHtpasswd(['alice' => 'secret123']);
        $this->assertFalse(validate_user('bob', 'secret123'));
    }

    public function testEmptyCredentials(): void
    {
        $this->writeHtpasswd(['alice' => 'secret123']);
        $this->assertFalse(validate_user('', 'secret123'));
        $this->assertFalse(validate_user('alice', ''));
    }

    public function testUsernameWithColon(): void
    {
        $this->writeHtpasswd(['alice' => 'secret123']);
        $this->assertFalse(validate_user('alice:foo', 'secret123'));
    }

    public function testRejectsNonBcryptHash(): void
    {
        // Apache MD5 format (should be rejected)
        $hash = '$apr1$xxxxxx$xxxxxxxxxxxxxxxxxxx';
        file_put_contents(HTPASSWD_FILE, "alice:$hash\n");
        $this->assertFalse(validate_user('alice', 'anything'));
    }

    public function testMissingHtpasswdFile(): void
    {
        $this->assertFalse(validate_user('alice', 'secret123'));
    }
}
