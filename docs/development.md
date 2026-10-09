# Development guide

[← Project overview](../README.md)

## Local application

Configure the application following [Quick start](../README.md#quick-start), then run:

```sh
php -S localhost:8000 -t public_html server.php
```

The browser application uses vanilla JavaScript without a frontend build step. Install the optional MCP server dependencies before running its checks:

```sh
npm ci --prefix mcp
```

## Verification

Tests never load the repository config.php or production credentials:

```sh
node --test tests/timer.test.mjs
php tests/api_test.php
php tests/obligations_test.php
cd mcp && npm test
```

PHP tests require PDO SQLite and mbstring. They exercise auth, JSON validation, rollback/revisions, goals CRUD, both task sources, habits, finance totals and secret notes. Node tests cover schemas, mocked errors, malformed responses, timeout, credential redaction and a real SDK stdio handshake. Optional API integration is skipped unless LIFEOS_TEST_BASE_URL is set.

For actual MySQL verification, start a disposable localhost MySQL/MariaDB instance on port 3308 with a test-only root account and empty password:

```sh
php tests/mysql_fixture.php 3308
php tests/api_mysql_test.php
# In the temporary app directory printed by the fixture command:
php -S localhost:8000 -t public_html server.php
# From the repository, with LIFEOS_TEST_BASE_URL=http://localhost:8000:
cd mcp && npm test
```

The fixture creates a random lifeos_api_test_* database and an app copy in system temp, synthetic sign-in (`api-fixture` / `fixture-only-password`), and a random token saved only in ignored .secrets/api-test-context.json. MySQL tests run concurrent workers. Integration verifies HTTP CRUD, habits, finance persistence through browser state, stale-write conflict and a real MCP process against local API. Stop test processes afterward and remove the disposable database/app copy. Do not run fixtures against a shared or production instance.

PHP syntax checks (POSIX shell):

```sh
php -l api.php
php -l api_auth.php
for file in lib/*.php; do php -l "$file"; done
```


### PowerShell syntax checks

```powershell
php -l api.php
php -l api_auth.php
Get-ChildItem lib/*.php | ForEach-Object { php -l $_.FullName }
```

### Integration environment on Windows

Set the test URL in the repository shell before running the MCP integration checks:

```powershell
$env:LIFEOS_TEST_BASE_URL = "http://localhost:8000"
npm test --prefix mcp
Remove-Item Env:LIFEOS_TEST_BASE_URL
```

Use the disposable fixture server described above. These checks do not verify production Apache configuration or every supported PHP version.

## Implementation boundaries

- Keep browser and API representations compatible; preserve existing metadata when updating records.
- Deploy revision-aware state handling and its browser client together.
- Keep real configuration, tokens, fixtures, and private uploads out of Git.
- Use a disposable database for destructive integration checks.

## Focus soundtrack

`public_html/assets/focus-audio.js` owns the Focus playlist and audio lifecycle. Users select built-in tracks in a collapsed checkbox picker; selections play in the order they were chosen, advance on `ended`, and repeat the queue. A single selected track repeats itself. Play/Pause resumes the same track position; Next advances without starting playback when paused. Removing the current track advances during playback; removing all tracks stops it.

Built-in selection order and volume are saved as `soundtrack: {tracks: string[], volume: number}` within the existing `edi_focus_v1` document, preserving timer/history fields. New users keep the original first-track default. Multiple local files can be appended via the file picker. Blob URLs remain session-only and are revoked when the page is unloaded, so file bytes and temporary URLs are never sent to the state API. Failed tracks are skipped once per playback attempt; if every selected track fails, playback pauses with a retry message. Autoplay restrictions require a user Play action.
