<?php

declare(strict_types=1);

// Explicit localhost-only disposable database and app copy. Never loads config.php.
$port = (int) ($argv[1] ?? 3308);
if ($port < 1024 || $port > 65535) throw new RuntimeException('Use a dedicated local test port.');
$root = dirname(__DIR__);
$database = 'lifeos_api_test_' . bin2hex(random_bytes(6));
$directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . $database;
mkdir($directory);
$copy = function (string $source, string $destination) use (&$copy): void {
    if (is_dir($source)) {
        if (!is_dir($destination)) mkdir($destination);
        foreach (scandir($source) as $name) if ($name !== '.' && $name !== '..' && $name !== 'storage') $copy($source . '/' . $name, $destination . '/' . $name);
    } else copy($source, $destination);
};
foreach (['public_html', 'lib', 'api.php', 'api_auth.php', 'db.php', 'auth.php', 'state.php', 'server.php', 'login.php', 'logout.php', 'credentials.php', 'attachments.php', 'weather.php'] as $file) $copy($root . '/' . $file, $directory . '/' . $file);
$token = bin2hex(random_bytes(32));
$config = ['db_host' => '127.0.0.1', 'db_port' => $port, 'db_name' => $database, 'db_user' => 'root', 'db_password' => '', 'username' => 'api-fixture', 'password' => 'fixture-only-password', 'api_token' => $token, 'api_allow_secret_notes' => false];
file_put_contents($directory . '/config.php', "<?php\nreturn " . var_export($config, true) . ";\n");
$server = new PDO('mysql:host=127.0.0.1;port=' . $port, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$server->exec('CREATE DATABASE `' . $database . '` CHARACTER SET utf8mb4');
require $directory . '/db.php';
$db = life_os_db();
require_once $root . '/lib/state_store.php';
$store = new StateStore($db);
$store->mutate(['kanban_boards_v1' => []], function (array &$docs) { $docs['kanban_boards_v1'] = ['activeBoardId' => 'fixture-board', 'boards' => [['id' => 'fixture-board', 'name' => 'Fixture', 'columns' => [['id' => 'todo', 'name' => 'To Do', 'cards' => []], ['id' => 'progress', 'name' => 'In Progress', 'cards' => []], ['id' => 'review', 'name' => 'Review', 'cards' => []], ['id' => 'done', 'name' => 'Done', 'cards' => []]]]]]; });
$db->exec("INSERT INTO categories(name, created_at) VALUES ('Learning', '2026-01-01')");
$db->exec("INSERT INTO habits(name, category, color, icon, created_at) VALUES ('Reading', 'Learning', '#00ffaa', '✓', '2026-01-01')");
// Include a sentinel secret note to exercise actual HTTP filtering.
$store->mutate(['edi_notes_v1' => []], function (array &$docs) { $docs['edi_notes_v1'] = ['notes' => [['id' => 'secret-sentinel', 'title' => 'Hidden', 'body' => 'NEVER_EXPOSE_SENTINEL', 'secret' => true, 'updated' => 1]], 'connections' => []]; });
$context = ['directory' => $directory, 'database' => $database, 'port' => $port, 'token' => $token];
if (!is_dir($root . '/.secrets')) mkdir($root . '/.secrets');
file_put_contents($root . '/.secrets/api-test-context.json', json_encode($context));
echo 'Disposable app: ' . $directory . "\nDatabase: " . $database . "\n";
