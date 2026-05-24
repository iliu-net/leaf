<?php
use PHPUnit\Framework\TestCase;

class JwtTest extends TestCase
{
    public function testEncodeReturnsThreeDotSegments(): void
    {
        $token = jwt_encode(['sub' => 'alice']);
        $parts = explode('.', $token);
        $this->assertCount(3, $parts);
        $this->assertNotEmpty($parts[0]);
        $this->assertNotEmpty($parts[1]);
        $this->assertNotEmpty($parts[2]);
    }

    public function testDecodeReturnsPayload(): void
    {
        $token   = jwt_encode(['sub' => 'alice']);
        $payload = jwt_decode($token);
        $this->assertIsArray($payload);
        $this->assertSame('alice', $payload['sub']);
    }

    public function testDecodeSetsIatAndExp(): void
    {
        $token   = jwt_encode(['sub' => 'bob']);
        $payload = jwt_decode($token);
        $this->assertArrayHasKey('iat', $payload);
        $this->assertArrayHasKey('exp', $payload);
        $this->assertGreaterThan($payload['iat'], $payload['exp']);
    }

    public function testRejectsTamperedToken(): void
    {
        $token = jwt_encode(['sub' => 'alice']);
        $parts = explode('.', $token);
        $parts[1] = base64url_encode(json_encode(['sub' => 'mallory']));
        $tampered = implode('.', $parts);
        $this->assertFalse(jwt_decode($tampered));
    }

    public function testRejectsExpiredToken(): void
    {
        $token   = jwt_encode(['sub' => 'alice', 'exp' => time() - 10]);
        $payload = jwt_decode($token);
        $this->assertFalse($payload);
    }

    public function testRejectsMalformedToken(): void
    {
        $this->assertFalse(jwt_decode('not-a-jwt'));
        $this->assertFalse(jwt_decode('header.body.sig.extra'));
        $this->assertFalse(jwt_decode(''));
    }

    public function testCustomExpiry(): void
    {
        $token   = jwt_encode(['sub' => 'alice'], 60);
        $payload = jwt_decode($token);
        $this->assertSame(time() + 60, $payload['exp'], '', 2);
    }

    public function testPreservesCustomClaims(): void
    {
        $token   = jwt_encode(['sub' => 'alice', 'custom' => 'value']);
        $payload = jwt_decode($token);
        $this->assertSame('value', $payload['custom']);
    }

    public function testBase64urlRoundtrip(): void
    {
        $data = "\x00\x01\x02\xff\xfe";
        $enc  = base64url_encode($data);
        $dec  = base64url_decode($enc);
        $this->assertSame($data, $dec);
    }
}
