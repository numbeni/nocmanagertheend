# NOC Monitor

## Overview
The NOC Monitor is a comprehensive website monitoring and incident detection system designed for hosting companies. It provides NOC-grade surveillance, classifying website statuses, detecting incidents, and offering diagnostic tools. The system ensures high availability and performance of monitored websites, providing real-time alerts and detailed insights into site health.

## Running the Project

### Access Key
The app requires an access key at startup: **`forunixsee`**

### How to Run
The **`artifacts/noc-monitor: web`** workflow is the primary way to run the project:
- Command: `pnpm --filter @workspace/api-server run dev`
- Runs the API server on **port 5000**, which also serves the pre-built frontend

### After Frontend Code Changes
Rebuild the frontend first, then restart the workflow:
```bash
BASE_PATH=/ PORT=5000 pnpm --filter @workspace/noc-monitor run build
```
Then restart `artifacts/noc-monitor: web`.

### After Backend Code Changes
Just restart `artifacts/noc-monitor: web` (no build needed for backend changes).

### After DB Schema Changes
```bash
pnpm --filter @workspace/db run push --force
```

---

## Running Locally (on Your Own Machine / VS Code)

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| pnpm | ≥ 9 | `npm install -g pnpm` |
| PostgreSQL | ≥ 14 | https://www.postgresql.org/download/ |

### 1 — Clone & install dependencies

```bash
git clone <your-repo-url> noc-monitor
cd noc-monitor
pnpm install
```

### 2 — Create a PostgreSQL database

```sql
-- In psql or any Postgres client:
CREATE DATABASE noc_monitor;
```

### 3 — Configure environment variables

Create a file called `.env` in the project root (it is git-ignored):

```env
# Required — paste your Postgres connection string here
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/noc_monitor

# Required by the API server and Vite build
PORT=5000

# Required by the frontend build
BASE_PATH=/
```

> You can also export these variables in your shell instead of using a `.env` file. The project uses `dotenv` loaded via the Node.js `--env-file` flag in development.

### 4 — Apply the database schema

```bash
pnpm --filter @workspace/db run push --force
```

### 5 — Build the frontend

```bash
BASE_PATH=/ PORT=5000 pnpm --filter @workspace/noc-monitor run build
```

This compiles the React app into `artifacts/noc-monitor/dist/public/`, which the API server then serves as static files.

### 6 — Start the API server (serves both API + frontend)

```bash
PORT=5000 pnpm --filter @workspace/api-server run dev
```

Open **http://localhost:5000** in your browser.

On first launch the app shows the founder setup wizard. Complete it to create your admin account.

---

### Quick reference — VS Code terminal workflow

```bash
# Terminal 1 — one-time setup
pnpm install
pnpm --filter @workspace/db run push --force
BASE_PATH=/ PORT=5000 pnpm --filter @workspace/noc-monitor run build

# Terminal 1 — start the app (API + static frontend)
PORT=5000 pnpm --filter @workspace/api-server run dev
```

**Iterating on backend code** — just kill and restart Terminal 1 (no rebuild needed).

**Iterating on frontend code** — rebuild first, then restart:
```bash
BASE_PATH=/ PORT=5000 pnpm --filter @workspace/noc-monitor run build
PORT=5000 pnpm --filter @workspace/api-server run dev
```

### Optional — external alert integrations

These are all optional and can be configured after first login via the Settings page or as environment variables:

```env
# Nextcloud Talk alerts
NEXTCLOUD_TALK_URL=https://your-nextcloud.example.com
NEXTCLOUD_TALK_USER=alertbot
NEXTCLOUD_TALK_PASSWORD=secret
NEXTCLOUD_TALK_ROOM=token1,token2

# Telegram alerts
TELEGRAM_BOT_TOKEN=123456:ABC-xyz
TELEGRAM_CHAT_ID=-100123456789

# Connectivity sentinel targets (optional — server-side runtime config only)
# Format: Name:host,Name:host,...
# Default: Google:google.com,Soft98:soft98.ir,Varzesh3:www.varzesh3.com
# Full URLs are normalized to hostname automatically (https://soft98.ir/ → soft98.ir)
CONNECTIVITY_TARGETS=Google:google.com,Soft98:soft98.ir,Varzesh3:www.varzesh3.com
```

## User Preferences
- Strings shown to the user MUST go through `t("…")`. Tech terms stay English in both locales.
- After modifying `lib/db/src/schema/*`: run `pnpm --filter @workspace/db run push --force` to apply DB changes.
- Restart the affected workflow after backend changes.
- The frontend is built once with `BASE_PATH=/ PORT=5000 pnpm --filter @workspace/noc-monitor run build` and served statically by the api-server.
- The "Start application" workflow runs only the api-server (`PORT=5000 pnpm --filter @workspace/api-server run dev`) on port 5000, which serves both the API and the built frontend.
- After frontend code changes, rebuild with `BASE_PATH=/ PORT=5000 pnpm --filter @workspace/noc-monitor run build` then restart "Start application".

## System Architecture
The project is structured as a pnpm monorepo.

**Backend:**
- Node.js + Express + TypeScript API server (`artifacts/api-server`) running on port `5000`.
- Auth: httpOnly cookie `noc_token` + optional Bearer header. SHA-256 token hash stored in `sessionsTable`. 7-day TTL.
- `requireAuth` checks cookie first, then Authorization header.
- `requireRole` checks role rank: founder (40) > admin (30) > operator (20) > viewer (10).
- Passwords hashed with bcrypt (12 rounds). Never double-hashed.
- `loginUser` searches by username first, then email. Includes dummy bcrypt call for timing safety when user not found.

**Frontend:**
- React + Vite + TypeScript + Tailwind + shadcn/ui (`artifacts/noc-monitor`).
- Auth context (`contexts/auth.tsx`): calls `/api/auth/me` on startup via cookie — no localStorage token needed.
- Session persists across page refreshes via httpOnly cookie.
- Internationalization with English and Farsi (defaults to Farsi).
- Setup page (`pages/setup.tsx`): shown only when user count = 0.
- Login page (`pages/login.tsx`): shown when setup is done but user is not authenticated.

**Database:**
- PostgreSQL via Drizzle ORM (`lib/db`).
- `users` table: id, firstName, lastName, displayName, email, username, passwordHash, role, **isFounder**, status, lastLoginAt, createdAt, updatedAt.
- `sessions` table: id, userId (FK→users), tokenHash (SHA-256), expiresAt, createdAt.
- `isFounder = true` → user cannot be deleted or disabled. Set on the first user created at setup.

## Auth System (Rebuilt)

### Flow
1. App loads → GET `/api/auth/setup-status`
2. If `setupRequired: true` → show Setup page (founder creation)
3. If `setupRequired: false` → GET `/api/auth/me` (cookie sent automatically)
4. If `/me` returns 401 → show Login page
5. If `/me` returns user → show app

### Endpoints
- `GET /api/auth/setup-status` — returns `{ setupRequired: bool }`
- `POST /api/auth/setup` — creates first founder account, sets cookie, auto-logs in
- `POST /api/auth/login` — authenticates, sets `noc_token` cookie
- `POST /api/auth/logout` — deletes session, clears cookie
- `GET /api/auth/me` — returns current user from cookie
- `POST /api/auth/change-password` — changes own password (requires current password)

### Roles
- `founder` (isFounder=true): Full access, cannot be deleted/disabled, created at setup
- `admin`: Manage users and settings
- `operator`: Dashboard, run checks, manage incidents
- `viewer`: Read-only

### Current Users (dev credentials)
- `behnia` / `NOCAdmin2024!` — admin, isFounder=true
- `morteza` / `NOCAdmin2024!` — admin
- `mahdi` — operator

## Audit Log System
- `lib/db/src/schema/sites.ts` — `auditLogsTable` added: id, timestamp, actorId, actorUsername, actorRole, action, resource, resourceId, details (JSON), ipAddress, userAgent, result
- `artifacts/api-server/src/services/audit.ts` — `writeAudit()`, `auditFromRequest()`, `queryAuditLogs()` helpers
- `artifacts/api-server/src/routes/audit.ts` — `GET /api/audit-logs` (admin/founder only, paginated + filters)
- Hooked into: auth.ts (login/logout/setup/change-password), users.ts (CRUD), settings.ts (update_settings)
- Frontend: `artifacts/noc-monitor/src/pages/audit-log.tsx` — table with search, action/resource/result filters, pagination
- Nav: sidebar shows "Audit Log" for admin/founder roles only

## Browser Notification System
- `artifacts/api-server/src/routes/notifications.ts` — `GET /api/notifications/recent` (incidents last 24h), `GET /api/notifications/stream` (SSE)
- `artifacts/noc-monitor/src/contexts/notifications.tsx` — NotificationsProvider: polls `/api/notifications/recent` every 30s, manages `NotifPrefs` in localStorage (`noc.notif.prefs`), fires browser Notification API when permission granted. Cross-tab deduplication via `noc.notif.shownIds` in localStorage.
- `artifacts/noc-monitor/src/components/notification-button.tsx` — Bell icon in topbar with unread badge, dropdown showing recent incidents
- Settings page — BrowserNotificationsSection: enable/disable, permission status + request button, severity filter toggles, sound toggle, requireInteraction toggle
- Prefs stored in `localStorage` keys: `noc.notif.prefs`, `noc.notif.lastSeen`, `noc.notif.shownIds`

## Theme System
- `artifacts/noc-monitor/src/theme/ThemeProvider.tsx` — supports "dark", "light", "system" (follows OS preference)
- Default: "system" (auto-detects dark/light from OS)
- Stored in localStorage key: `noc-monitor:theme`
- Settings page shows all three options; "system" is local-only and not synced to server

## Key Files
- `lib/db/src/schema/users.ts` — users and sessions schema (includes isFounder boolean)
- `lib/db/src/schema/sites.ts` — all main tables + auditLogsTable
- `artifacts/api-server/src/services/auth.ts` — hashPassword, verifyPassword, loginUser, validateToken, createUser, updateUser
- `artifacts/api-server/src/services/audit.ts` — audit log write + query
- `artifacts/api-server/src/middlewares/auth.ts` — requireAuth (cookie-first), requireRole (rank-based)
- `artifacts/api-server/src/routes/auth.ts` — setup, login, logout, me, change-password (+ audit hooks)
- `artifacts/api-server/src/routes/users.ts` — CRUD (founder-protected) (+ audit hooks)
- `artifacts/api-server/src/routes/audit.ts` — audit log API
- `artifacts/api-server/src/routes/notifications.ts` — SSE stream + recent incidents
- `artifacts/noc-monitor/src/contexts/auth.tsx` — cookie-based auth context (no localStorage)
- `artifacts/noc-monitor/src/contexts/notifications.tsx` — browser notification context (cross-tab dedup)
- `artifacts/noc-monitor/src/pages/setup.tsx` — founder setup page
- `artifacts/noc-monitor/src/pages/login.tsx` — login page
- `artifacts/noc-monitor/src/pages/users.tsx` — user management (reset password, toggle status)
- `artifacts/noc-monitor/src/pages/profile.tsx` — profile + change password
- `artifacts/noc-monitor/src/pages/audit-log.tsx` — audit log viewer (admin/founder only)
- `artifacts/noc-monitor/src/pages/logs.tsx` — event logs (fully i18n)
- `artifacts/noc-monitor/src/components/layout.tsx` — sidebar + user dropdown + notification bell
- `artifacts/noc-monitor/src/components/notification-button.tsx` — bell icon with unread badge
- `artifacts/noc-monitor/src/i18n/translations.ts` — EN + FA translations
- `artifacts/noc-monitor/src/theme/ThemeProvider.tsx` — dark/light/system theme
- `artifacts/api-server/src/monitoring/engine.ts` — monitoring scheduler
- `artifacts/api-server/src/routes/dns-performance.ts` — DNS performance analytics

## External Dependencies
- **PostgreSQL**: Primary database.
- **Nextcloud Talk**: Company-level alerts via OCS API.
- **Cloudflare / Google / Quad9**: DNS resolvers.
- **Tailwind CSS + shadcn/ui**: Styling and UI components.
- **React Query**: Data fetching/caching.
- **Vite**: Frontend build tool.
- **Express + TypeScript**: Backend framework.
- **Drizzle ORM**: Database ORM.
- **bcryptjs**: Password hashing.
