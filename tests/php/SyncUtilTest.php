<?php
use PHPUnit\Framework\TestCase;

/**
 * Tests for utility functions in api/sync.php.
 *
 * safe_id() is defined in sync.php which can't be loaded in isolation
 * (its top-level code reads php://input). We test the sanitization logic
 * with an equivalent inline implementation.
 */
class SyncUtilTest extends TestCase
{
    /**
     * Inline copy of safe_id() from api/sync.php — kept in sync manually.
     */
    private function safeId(string $raw): string
    {
        $raw = trim($raw);
        $raw = str_replace('/', ':', $raw);
        $raw = preg_replace('/^\.+/', '_', $raw);
        return preg_replace('/[^a-zA-Z0-9_\-\.$%\'@~!(){}^#&`:]/u', '_', $raw);
    }

    // ── Path separator mapping ────────────────────────────────────────────

    public function testMapsSlashToColon(): void
    {
        $this->assertSame('foo:bar', $this->safeId('foo/bar'));
    }

    public function testMapsMultipleSlashes(): void
    {
        $this->assertSame('a:b:c', $this->safeId('a/b/c'));
    }

    public function testMapsLeadingSlash(): void
    {
        $this->assertSame(':foo', $this->safeId('/foo'));
    }

    // ── Leading dot handling ──────────────────────────────────────────────

    public function testLeadingDotReplaced(): void
    {
        $this->assertSame('_foo', $this->safeId('.foo'));
    }

    public function testMultipleLeadingDotsReplaced(): void
    {
        $this->assertSame('_foo', $this->safeId('...foo'));
    }

    public function testDotAloneReplaced(): void
    {
        $this->assertSame('_', $this->safeId('.'));
    }

    public function testDoubleDotAloneReplaced(): void
    {
        $this->assertSame('_', $this->safeId('..'));
    }

    public function testDotInMiddlePreserved(): void
    {
        $this->assertSame('foo.bar', $this->safeId('foo.bar'));
    }

    // ── Allowed special characters ────────────────────────────────────────

    public function testAllowsSpecialChars(): void
    {
        $input  = 'a$b%c\'d@e~f!g(h)i{j}k^l#m&n:o`p';
        $result = $this->safeId($input);
        $this->assertSame($input, $result);
    }

    // ── Unsafe character stripping ─────────────────────────────────────────

    public function testStripsSpaces(): void
    {
        $this->assertSame('foo_bar', $this->safeId('foo bar'));
    }

    public function testStripsTabs(): void
    {
        $this->assertSame('foo_bar', $this->safeId("foo\tbar"));
    }

    public function testStripsNewlines(): void
    {
        $this->assertSame('foo_bar', $this->safeId("foo\nbar"));
    }

    public function testStripsAngleBrackets(): void
    {
        $this->assertSame('foo_bar_', $this->safeId('foo<bar>'));
    }

    public function testStripsDoubleQuotes(): void
    {
        $this->assertSame('foo_bar_', $this->safeId('foo"bar"'));
    }

    // ── Trimming ──────────────────────────────────────────────────────────

    public function testTrimsWhitespace(): void
    {
        $this->assertSame('foo', $this->safeId('  foo  '));
    }

    // ── Mixed scenarios ───────────────────────────────────────────────────

    public function testMixedSanitization(): void
    {
        $input  = "  ../etc/passwd  ";
        $result = $this->safeId($input);
        // Leading dots replaced, slashes mapped to colons, spaces stripped
        $this->assertSame('_:etc:passwd', $result);
    }

    public function testSafeFilenameRoundtrip(): void
    {
        $input = 'my-note_v2.0';
        $this->assertSame($input, $this->safeId($input));
    }
}
