# Edi Life OS

A private dashboard for focus, finance, habits, kanban, goals, and Markdown notes. Requires PHP 8.1+, mbstring, PDO MySQL, and MySQL 8+ (also tested with MariaDB 10.4). App data is stored in MySQL. Existing browser data is imported once; conflicting older copies are archived in the `app_state` table as `legacy_backup_*` rows.

![Edi Life OS preview](intro-preview.gif)

## Setup

1. Copy `config.example.php` to `config.php`, then set your MySQL host, database name, database account, and app login. `config.php` is ignored by Git; **never commit real credentials**.
2. Ensure the MySQL account can create the database and tables (or have an administrator grant those privileges).
3. From the repository root, run `php -S localhost:8000 -t public_html server.php` and open <http://localhost:8000>. The first login creates the database and all tables automatically.

For Apache, use `public_html` as the document root and enable `.htaccess` rewrites. Use HTTPS outside localhost.

The app login in `config.php` seeds the `app_credentials` table on first use. After that, use **Settings → Sign-in credentials** to change the username or password. The password is stored as a hash in MySQL, and saving credentials signs out other sessions.

To preserve an existing Habittify SQLite database, run `php migrate-sqlite.php /absolute/path/to/habits.db` **before opening the app** with the new MySQL database. This requires empty habit tables and leaves the SQLite file untouched.

Run `node --test tests/timer.test.mjs` for timer checks.

The Overview weather card loads Qeshm Island's current forecast and next seven days through the local `weather.php` endpoint, which requests Open-Meteo over verified HTTPS. Its tide trend and next high/low are derived from Open-Meteo's nearby offshore hourly sea-level model; this is a coastal estimate above mean sea level, not navigation data. The server needs internet access and PHP cURL. The card shows an unavailable state if either feed fails.

## LifeOS API

The private `/api/v1/*` API uses a dedicated bearer token, independent of browser sign-in. Generate at least 32 random bytes (for example `php -r 'echo bin2hex(random_bytes(32));'`) and place the result in the ignored `config.php` as `api_token`, or set `LIFEOS_API_TOKEN` on the PHP process. The environment takes precedence, including an empty value that disables access. Placeholder tokens and tokens shorter than 32 characters are rejected. Keep `api_allow_secret_notes` false unless secret-note API access is intended.

```sh
curl -H "Authorization: Bearer $LIFEOS_API_TOKEN" \
  https://example.com/api/v1/dashboard

curl -X POST -H "Authorization: Bearer $LIFEOS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Build dream home studio","specific":"Turn a 3x3m room into a studio","priority":"high","startDate":"2026-10-07","deadline":"2027-01-07","measures":[{"metric":"Studio Readiness Score","target":8,"unit":"/10","current":0}],"tasks":[{"title":"Repair walls"},{"title":"Install carpet"}]}' \
  https://example.com/api/v1/goals

curl -X POST -H "Authorization: Bearer $LIFEOS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"category_id":"food","description":"Dinner","amount":450000,"date":"2026-10-07"}' \
  https://example.com/api/v1/finance/expenses
```

Use HTTPS outside localhost: the token grants read/write access to the domains below. Never put it in URLs, Git, screenshots, logs or frontend JavaScript. Rotate it by changing the server setting and client environment. No endpoint returns config or credentials. This is a single-owner API, without token scopes or a rate limiter. Configure host-level request limits and omit Authorization headers from access logs. Errors contain no stack traces or SQL parameters.

### Routes and formats

Success is `{ "data": ... }`; errors are `{ "error": { "code": "...", "message": "...", "details": {} } }`. Creation/upsert POSTs return 201; completion returns 200. Deletion returns `{ "data": { "deleted": true } }`. Responses are JSON with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Request bodies are limited to 1 MB; saved documents to 2 MB. Statuses: malformed JSON 400, unauthorized 401, forbidden secret access 403, absent resource 404, wrong method 405, conflict 409, oversized 413, validation 422, internal failure 500 and database failure 503.

| Domain | Routes relative to `/api/v1` | Behavior |
| --- | --- | --- |
| Context | `GET /health`, `GET /dashboard` | Authenticated health and compact Tehran dashboard |
| Goals | `GET/POST /goals`, `GET/PATCH/DELETE /goals/{id}` | SMART goals with nested tasks/measures |
| Tasks | `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/complete` | Goal checklists and Kanban cards |
| Habits | `GET /habits`, `GET /habits/today`, `POST/DELETE /habits/{id}/complete` | Existing SQL tables, idempotent completion |
| Finance | `GET /finance`, `GET/POST /finance/expenses`, `GET/POST /finance/incomes` | Existing period map, Toman amounts |
| Notes | `GET/POST /notes`, `GET/PATCH/DELETE /notes/{id}` | Sticky notes and connection cleanup |

Unsupported request fields are rejected; existing unknown fields are preserved. PATCH merges supported fields; supplied `tasks`/`measures` lists replace their lists, preserving extra fields on entries with matching IDs. Missing IDs are UUIDs. Goal status follows the UI: all tasks done means completed; editable status is active or archived. Numeric measure values can be null. Dates must be real ISO dates; startDate cannot follow deadline.

Tasks require `source: "goal"` with `goal_id`, or `source: "kanban"` with `board_id` and `column_id`. Lists accept source/container filters. Individual routes accept `source`, `goal_id`, `board_id` when an ID is ambiguous (otherwise 409). Goal tasks inherit the goal deadline unless they have their own dueDate. Goal tasks do not support descriptions. Kanban completion uses normalized column names Done, Completed or Complete; completing moves to an existing such column, otherwise 409. Reopening requires `done: false` with a non-complete column_id. Card labels, attachments, comments and checklists survive updates.

Habit completion accepts optional `{ "date": "YYYY-MM-DD" }`, defaulting to today in Asia/Tehran. Two completes leave one completed row; two uncompletes leave none. Archived habits cannot be completed. The browser retains its existing toggle behavior.

Finance accepts an existing `period` (query for GET, body for POST), defaulting to active or the first saved period like the UI. Expenses require an existing category_id and positive amount; description and ISO date are optional. Stored expenses retain `{id, categoryId, desc, amount, date}` and an English month/day label like the UI; the year is identified by the period. Incomes require name and positive amount; the lowercased name with whitespace replaced by underscores generates the ID. Repeating that ID updates its amount. Active-period writes synchronize the legacy daramd_v1 mirror, retaining other periods. An uninitialized account gets the same default categories as the browser.

Secret notes are excluded from default reads and dashboard. Hidden IDs return 404 for get/update/delete. `include_secret=1` requires `api_allow_secret_notes => true`, otherwise 403. Creating or making a note secret returns only ID and secret flag unless access was explicitly enabled/requested. Notes use UI geometry/font defaults. Delete removes related `{a,b}` connections.

### Concurrency and hosting

API mutations lock app_state rows in key order within a transaction (`SELECT ... FOR UPDATE`), including absent-row initialization. Habit writes use the existing unique habit/date key and transactions. No schema migration is required.

Browser saves send a SHA-256 revision from their last load/successful write. Stale saves return 409, stop queued saves for that document and ask the user to copy unsaved edits and reload. This prevents a stale whole-document save from overwriting API changes; it does not merge edits. Reload after external updates. Deploy state.php, lib/ and assets/storage.js together; reload already-open clients. Old clients without revisions are rejected rather than overwriting newer data.

The PHP development router and Apache router.php/.htaccess route API requests before session authentication. Apache must preserve Authorization; the supplied rewrite does this. Keep public_html as document root for standard Apache hosting. For flattened shared hosting, put API PHP files/lib alongside the backend and adapt server.php's public root, router.php and Habittify's helper paths to that layout. Never expose config.php, mcp/, tests or private storage as downloadable assets.

## MCP Server

The Node stdio server uses the [official MCP SDK](https://ts.sdk.modelcontextprotocol.io/server), calls only HTTP API routes, and has no database credentials. See [mcp/README.md](mcp/README.md) for tools and client configuration.

```sh
cd mcp
npm install
cp .env.example .env
# Set LIFEOS_BASE_URL=https://example.com and LIFEOS_API_TOKEN
npm start
npm test
```

Use Node 22.9+ (24 recommended). npm start loads the ignored .env from mcp; direct script launches need client-provided environment or Node --env-file. This server has no remotely hosted MCP HTTP endpoint.

## API/MCP verification

Tests never load the repository config.php or production credentials:

```sh
node --test tests/timer.test.mjs
php tests/api_test.php
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

## Calendar

Open Calendar (`#calendar`) for due cards from every Kanban board. Month places cards on their saved due dates; Schedule lists all dated cards across months. Board filters, search, an overdue list, and an optional completed-card filter help narrow the view. Completed cards are included by default. Cards without a valid due date are counted separately. Dates and overdue status use Asia/Tehran, and selecting an event opens its original Kanban card editor. Board changes update the calendar through the existing shared state channel; Refresh reloads the latest MySQL state.
