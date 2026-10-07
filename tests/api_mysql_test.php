<?php

declare(strict_types=1);

$context = json_decode(file_get_contents(dirname(__DIR__) . '/.secrets/api-test-context.json'), true, 64, JSON_THROW_ON_ERROR);
$directory = $context['directory'];
if (!preg_match('/^lifeos_api_test_[a-f0-9]{12}$/D', basename($directory)) || realpath(dirname($directory)) !== realpath(sys_get_temp_dir())) throw new RuntimeException('Only a disposable fixture directory is allowed.');
require $directory . '/db.php';
require dirname(__DIR__) . '/lib/state_store.php';
$db = life_os_db();
$store = new StateStore($db);
$db->exec("DELETE FROM app_state WHERE state_key = 'concurrency_fixture'");
$workers = [];
for ($index = 0; $index < 2; $index++) {
    $process = proc_open([PHP_BINARY, __DIR__ . '/state_worker.php', $directory], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $workers[] = [$process, $pipes];
}
foreach ($workers as [$process, $pipes]) {
    $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]);
    if (proc_close($process) !== 0) throw new RuntimeException('Worker failed: ' . $output);
}
if ($store->get('concurrency_fixture', [])['count'] !== 50) throw new RuntimeException('Concurrent increments lost.');
$revision = hash('sha256', $store->raw('concurrency_fixture'));
$store->mutate(['concurrency_fixture' => []], function (array &$docs) { $docs['concurrency_fixture']['count']++; });
try { $store->compareAndSwap('concurrency_fixture', '{"count":0}', $revision); throw new RuntimeException('Stale write was accepted.'); }
catch (ApiException $error) { if ($error->status !== 409) throw $error; }
echo "PASS: MySQL concurrent missing-row initialization, 50 atomic increments and stale-write conflict\n";
