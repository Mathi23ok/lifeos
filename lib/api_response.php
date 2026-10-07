<?php

declare(strict_types=1);

final class ApiException extends RuntimeException
{
    public function __construct(public int $status, public string $errorCode, string $message, public array $details = [])
    {
        parent::__construct($message);
    }
}

function api_json(mixed $data, int $status = 200): never
{
    api_reply(['data' => $data], $status);
}

function api_reply(array $payload, int $status): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function api_error(int $status, string $code, string $message, array $details = []): never
{
    api_reply(['error' => ['code' => $code, 'message' => $message, 'details' => (object) $details]], $status);
}

function api_decode_body(string $raw): array
{
    if (strlen($raw) > 1_000_000) throw new ApiException(413, 'payload_too_large', 'Request exceeds 1 MB.');
    if ($raw === '') return [];
    try { $value = json_decode($raw, false, 64, JSON_THROW_ON_ERROR); }
    catch (JsonException) { throw new ApiException(400, 'malformed_json', 'Body must be valid JSON.'); }
    if (!$value instanceof stdClass) throw new ApiException(400, 'malformed_json', 'Body must be a JSON object.');
    return json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
}

function api_body(): array
{
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 1_000_000) throw new ApiException(413, 'payload_too_large', 'Request exceeds 1 MB.');
    $raw = file_get_contents('php://input', false, null, 0, 1_000_001);
    return api_decode_body($raw === false ? '' : $raw);
}

function api_method(array $allowed, string $method): void
{
    if (!in_array($method, $allowed, true)) {
        header('Allow: ' . implode(', ', $allowed));
        throw new ApiException(405, 'method_not_allowed', 'Method not allowed.');
    }
}

function api_uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}

function api_now(): int { return (int) floor(microtime(true) * 1000); }
function api_today(): string { return (new DateTimeImmutable('now', new DateTimeZone('Asia/Tehran')))->format('Y-m-d'); }

function api_fields(array $body, array $allowed): void
{
    foreach ($body as $field => $_) {
        if (!in_array($field, $allowed, true)) throw new ApiException(422, 'validation_error', 'Unsupported field: ' . $field);
    }
}

function api_text(mixed $value, string $field, int $max = 200, bool $required = false): string
{
    if (!is_string($value)) throw new ApiException(422, 'validation_error', "$field must be a string.");
    $value = trim($value);
    if (($required && $value === '') || mb_strlen($value, 'UTF-8') > $max) throw new ApiException(422, 'validation_error', "$field is required and must be at most $max characters.");
    return $value;
}

function api_date(mixed $value, string $field): ?string
{
    if ($value === null || $value === '') return null;
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) throw new ApiException(422, 'validation_error', "$field must be YYYY-MM-DD.");
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    if (!$date || $date->format('Y-m-d') !== $value) throw new ApiException(422, 'validation_error', "$field must be a real ISO date.");
    return $value;
}

function api_enum(mixed $value, string $field, array $allowed): string
{
    if (!is_string($value) || !in_array($value, $allowed, true)) throw new ApiException(422, 'validation_error', "$field must be one of: " . implode(', ', $allowed));
    return $value;
}

function api_number(mixed $value, string $field, float $minimum = 0): int|float
{
    if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value) || $value < $minimum || $value > 1e15) throw new ApiException(422, 'validation_error', "$field must be a finite number between $minimum and 1e15.");
    return $value;
}

function api_bool(mixed $value, string $field): bool
{
    if (!is_bool($value)) throw new ApiException(422, 'validation_error', "$field must be boolean.");
    return $value;
}

function api_list(mixed $value, string $field, int $max = 500): array
{
    if (!is_array($value) || !array_is_list($value) || count($value) > $max) throw new ApiException(422, 'validation_error', "$field must be a list with at most $max entries.");
    return $value;
}
