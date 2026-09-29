<?php

declare(strict_types=1);

require_once __DIR__ . '/auth.php';
life_os_require_auth();
life_os_start_session();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function credentials_reply(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$_SESSION['state_csrf'] ??= bin2hex(random_bytes(32));

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    try {
        credentials_reply([
            'username' => life_os_username(),
            'csrf' => $_SESSION['state_csrf'],
        ]);
    } catch (Throwable $error) {
        error_log($error->__toString());
        credentials_reply(['error' => 'Credentials are unavailable.'], 503);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: GET, POST');
    credentials_reply(['error' => 'Method not allowed.'], 405);
}

if (!hash_equals((string) $_SESSION['state_csrf'], (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
    credentials_reply(['error' => 'Refresh the page and try again.'], 403);
}

$raw = (string) file_get_contents('php://input');
if (strlen($raw) > 20_000) credentials_reply(['error' => 'Request is too large.'], 413);
$input = json_decode($raw, true);
if (!is_array($input)) credentials_reply(['error' => 'Invalid request.'], 400);

$currentPassword = (string) ($input['current_password'] ?? '');
$newUsername = trim((string) ($input['new_username'] ?? ''));
$newPassword = (string) ($input['new_password'] ?? '');
$confirmPassword = (string) ($input['confirm_password'] ?? '');

if ($currentPassword === '') credentials_reply(['error' => 'Enter your current password to confirm this change.'], 400);
if ($newUsername === '' || strlen($newUsername) > 190 || preg_match('/[\x00-\x20\x7F]/', $newUsername)) {
    credentials_reply(['error' => 'Choose a username of 1–190 characters with no spaces.'], 400);
}
if ($newPassword !== '' && (strlen($newPassword) < 12 || strlen($newPassword) > 200)) {
    credentials_reply(['error' => 'A new password must be between 12 and 200 characters.'], 400);
}
if ($newPassword !== '' && !hash_equals($newPassword, $confirmPassword)) {
    credentials_reply(['error' => 'The new passwords do not match.'], 400);
}

try {
    $db = life_os_db();
    $db->beginTransaction();
    $query = $db->query('SELECT username, password_hash FROM app_credentials WHERE credential_id = 1 FOR UPDATE');
    $credentials = $query->fetch();
    if (!is_array($credentials) || !password_verify($currentPassword, (string) $credentials['password_hash'])) {
        $db->rollBack();
        credentials_reply(['error' => 'Your current password is incorrect.'], 403);
    }
    if ($newUsername === $credentials['username'] && $newPassword === '') {
        $db->rollBack();
        credentials_reply(['error' => 'Enter a new username or a new password.'], 400);
    }

    $passwordHash = $newPassword === ''
        ? (string) $credentials['password_hash']
        : password_hash($newPassword, PASSWORD_DEFAULT);
    if (!is_string($passwordHash)) throw new RuntimeException('Could not hash the new password.');

    $update = $db->prepare('UPDATE app_credentials SET username = ?, password_hash = ? WHERE credential_id = 1');
    $update->execute([$newUsername, $passwordHash]);
    $db->commit();

    session_regenerate_id(true);
    $_SESSION['life_os_authenticated'] = true;
    $_SESSION['life_os_username'] = $newUsername;
    $_SESSION['life_os_fingerprint'] = life_os_credential_fingerprint([
        'username' => $newUsername,
        'password_hash' => $passwordHash,
    ]);

    credentials_reply([
        'ok' => true,
        'username' => $newUsername,
        'csrf' => $_SESSION['state_csrf'],
    ]);
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    error_log($error->__toString());
    credentials_reply(['error' => 'Could not update sign-in credentials.'], 500);
}
