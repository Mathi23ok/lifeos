# Edi Life OS

**A personal workspace for focus, habits, finances, and meaningful progress.**

Edi Life OS brings everyday planning into one private dashboard. Manage projects, build small habits, track money, and keep your notes close—with a shared visual style across every page.

Built with PHP, MySQL, and vanilla JavaScript. The browser application requires no frontend build step.

![Edi Life OS dashboard preview](intro-preview.gif)

[Features](#features) · [Getting started](#getting-started) · [API](#api-and-integrations) · [Development](docs/development.md) · [Deployment](docs/deployment.md)

## Features

| Workspace | What you can do |
| --- | --- |
| **Overview** | See focus activity, habit progress, goals, finances, and a seven-day weather forecast. |
| **Growth** | Connect six life dimensions to long-term goals, existing SMART goals, habits and tasks. Track progress and complete weekly, monthly or quarterly reviews. |
| **Focus** | Work in timed sessions with short and long breaks, progress tracking, and session history. |
| **Finance** | Track expenses, income streams, and budgets in Toman. Manage recurring payments, subscriptions, installments and debts with generated dues, transaction links and a monthly commitments dashboard. |
| **Habittify** | Maintain daily habits and follow completion, streaks, and monthly progress. |
| **Kanban** | Organize projects with draggable cards and lists, priorities, labels, dates, checklists, comments, and file attachments. Move cards between projects. |
| **Calendar** | View due cards across all boards in Month or Schedule view, with search, board filters, and overdue items. |
| **Goals** | Plan SMART goals with multiple measures, deadlines, priorities, and sortable task checklists. |
| **Notepad** | Write Markdown notes with editing, preview, and export. |
| **Notes** | Arrange sticky notes with colors, fonts, and connections. |
| **Settings** | Change the theme and manage your sign-in credentials. |

Calendar uses **Asia/Tehran** for dates and overdue status. Selecting an event opens its original Kanban card.
Financial dues also appear in Calendar and open their payment in Finance. [Financial commitments](docs/financial-commitments.md) distinguishes optional subscription skips from unpaid debt deferrals and records payments atomically with ledger expenses.

The [personal growth workspace](docs/growth.md) connects Religion & Spirituality, Health, Relationships & Family, Finance, Self Growth, and Fun & Rest. Existing Goals, Habittify and Kanban records remain the source of truth; connections and review snapshots are stored separately.

The weather card shows current conditions and a seven-day forecast for Qeshm Island through Open-Meteo. Its tide information is a modeled coastal estimate and is unsuitable for navigation. Weather requires PHP cURL and outbound HTTPS access.

## Requirements

| Component | Requirement |
| --- | --- |
| PHP | **8.1+**, with `pdo_mysql` and `mbstring` |
| Database | **MySQL 8+**; also tested with MariaDB 10.4 |
| Web server | PHP development server locally; Apache with rewrite support for hosting |
| Weather | PHP `curl` extension and outbound HTTPS access |
| MCP server | Optional: **Node.js 22.9+** and npm |
| PHP API tests | Optional: `pdo_sqlite` in addition to the application extensions |

## Getting started

### 1. Get the source

```sh
git clone https://github.com/edrisranjbar/lifeos.git
cd lifeos
```

### 2. Configure the application

Copy the example configuration:

```sh
cp config.example.php config.php
```

On Windows PowerShell:

```powershell
Copy-Item config.example.php config.php
```

Edit `config.php` with your database connection and initial app username and password. Use an account that can create the database and application tables, or arrange those privileges with your database administrator.

**Keep real credentials in the ignored `config.php`. Never commit them.**

### 3. Start the local server

From the repository root:

```sh
php -S localhost:8000 -t public_html server.php
```

Open [localhost:8000](http://localhost:8000) and sign in with the credentials you configured. The backend creates its database and tables on first database access.

### 4. Manage your sign-in

The configured login seeds the `app_credentials` table on first use. After that, change your username or password in **Settings → Sign-in credentials**. Passwords are hashed in MySQL; changing credentials signs out other sessions.

For Apache and shared hosting, follow the [deployment guide](docs/deployment.md).

## Data and persistence

Application state is stored in MySQL. Habits and completion logs use dedicated tables; other workspaces use JSON documents in `app_state`.

- Existing browser data is imported once. Conflicting older copies are archived as `legacy_backup_*` records.
- Browser saves use revision checks to protect against stale changes. If a conflict occurs, preserve your unsaved edits and reload.
- API mutations use transactions and row locks. Reload the browser after changes made through an external client.
- Back up the database, private attachment files, and deployment configuration together.

Migrating an existing Habittify SQLite database? Follow the [migration instructions](docs/deployment.md#migrating-habittify-from-sqlite) before opening Habittify against the new database.

## API and integrations

### HTTP API

The private `/api/v1` API provides access to dashboard context, goals, tasks, habits, finances, and sticky notes. It uses a dedicated bearer token independent of browser sign-in.

Generate a token:

```sh
php -r "echo bin2hex(random_bytes(32));"
```

Set it as `api_token` in the ignored server configuration, or as the PHP process environment variable `LIFEOS_API_TOKEN`. Configure the same token in your client environment.

Example request in a POSIX shell:

```sh
curl -H "Authorization: Bearer $LIFEOS_API_TOKEN" \
  https://example.com/api/v1/dashboard
```

Use your own application URL. See the [API reference](docs/api.md) for authentication, endpoints, payloads, and error handling.

### MCP server

The optional Node.js MCP server exposes application tools over **stdio** and calls the HTTP API. It does not require database credentials.

```sh
cd mcp
npm ci
cp .env.example .env
# Set LIFEOS_BASE_URL and LIFEOS_API_TOKEN in .env
npm start
```

On Windows, use `Copy-Item .env.example .env`. See the [MCP guide](mcp/README.md) for available tools and client configuration.

There is no remotely hosted MCP HTTP endpoint. The application API URL is not an MCP transport URL.

## Project structure

```text
public_html/          Browser pages, assets, and Apache entry points
lib/                  API domains, response helpers, and state transactions
mcp/                  Optional Node.js stdio MCP server
tests/                Timer, API, MySQL, and integration checks
docs/                 API, development, and deployment guides
config.example.php    Configuration template without real credentials
server.php            PHP development router and application routing
api.php               HTTP API entry point
```

## Development

See the [development guide](docs/development.md) for local checks and an isolated MySQL integration workflow.

The test fixtures use disposable data and do not load the repository's production configuration. Running tests locally does not establish compatibility with a particular hosting environment.

## Security

Edi Life OS is designed for a **single owner**. The API token grants read and write access to its supported domains; token scopes and application-level rate limiting are not implemented.

Use HTTPS outside localhost. Keep tokens out of URLs, frontend code, screenshots, and logs, and configure request limits at the hosting layer.

Secret notes are hidden from API reads by default. Their secret flag controls visibility; it does not provide separate encrypted storage.

## Documentation

- [API reference](docs/api.md) — authentication, routes, data formats, and concurrency.
- [MCP guide](mcp/README.md) — tools, environment settings, and client setup.
- [Deployment guide](docs/deployment.md) — Apache, shared hosting, backups, and migration.
- [Development guide](docs/development.md) — local checks and disposable integration fixtures.
