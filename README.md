# AWS Route53 Clone

Functional Route53-style clone built with **Next.js 14** (TypeScript), **FastAPI** (Python), and **SQLite** persistence.

## Repository Layout

```
├── frontend/          # Next.js 14 app (TypeScript, App Router)
│   ├── app/           # Pages: dashboard, hosted-zones, login, …
│   ├── components/    # AppShell, ui.tsx (Modal, Pagination, Breadcrumb, Skeleton, …)
│   └── lib/           # api.ts, auth.ts, hooks.ts, types.ts
├── backend/           # FastAPI app
│   ├── app/
│   │   ├── main.py    # Routes: /api/auth/*, /api/hosted-zones/*, /api/stats
│   │   ├── crud.py    # Business logic + record type validation
│   │   ├── database.py# SQLite init, UUID PKs, seed data
│   │   └── schemas.py # Pydantic models with enums
│   └── requirements.txt
└── README.md
```

## Features

- **JWT authentication** — login with any email + any password (mocked)
- **Hosted zone CRUD** — create, edit (name immutable), delete, search, sort, paginate
- **DNS record CRUD** — supports A, AAAA, CNAME, TXT, MX, NS, PTR, SRV, CAA, SOA
- **Record type validation** — IPv4 (A), IPv6 (AAAA), hostname (CNAME), MX format, SRV format, CAA format
- **Auto NS + SOA** — new zones automatically get default NS and SOA records
- **Apex protection** — apex NS and SOA records cannot be deleted
- **Routing policies** — Simple, Weighted, Latency, Failover, Geolocation, Multivalue
- **TTL presets** — 1m, 5m, 1h, 12h, 1d quick-set buttons
- **Sort + filter** — sortable table columns, type filter dropdown
- **Breadcrumbs** — Route 53 › Hosted zones › zone.name
- **Bulk delete** — checkbox multi-select with bulk delete for records
- **Export** — JSON and BIND zone file export for any hosted zone
- **Keyboard shortcuts** — `Escape` closes modals, `/` focuses search
- **Mocked sections** — Traffic Policies, Health Checks, Resolver, Profiles placeholder pages

## Setup

### Prerequisites

- Python 3.11+
- Node.js 20+

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
# Create .env.local (see .env.local.example):
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000" > .env.local
npm run dev
```

Open the app at **http://localhost:3000**.

## Environment Variables

### Frontend — `frontend/.env.local`

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | FastAPI backend base URL (no trailing slash) | `http://localhost:8000` |

See `frontend/.env.local.example` for the template.

### Backend — environment or `.env`

| Variable | Description | Default |
|---|---|---|
| `SECRET_KEY` | JWT signing secret — **change in production!** | hardcoded dev value |

See `backend/.env.example` for the template.

## Architecture

The backend exposes all resources under `/api` prefix. The frontend's `apiFetch` utility automatically prepends `/api` to all calls and attaches the JWT bearer token from `localStorage`. Auth state is validated on every page load via `GET /api/auth/me`.

## Database Schema

| Table | Primary Key | Key Fields |
|---|---|---|
| `users` | `id` (UUID TEXT) | `username`, `email`, `display_name`, `password_hash` |
| `sessions` | `token` (JWT TEXT) | `user_id` → users, `expires_at` |
| `hosted_zones` | `id` (UUID TEXT) | `name`, `zone_type`, `caller_reference`, `user_id` → users |
| `dns_records` | `id` (UUID TEXT) | `zone_id` → hosted_zones, `record_type`, `routing_policy`, `values_json` |

All tables use UUID v4 string primary keys. SQLite `PRAGMA foreign_keys = ON` enforces referential integrity.

## API Endpoints (all under `/api`)

### Auth
- `POST /api/auth/login`   — `{email, password}` → `{token, user}`
- `POST /api/auth/logout`
- `GET  /api/auth/me`      → `AuthUser`

### Hosted Zones
- `GET    /api/hosted-zones`                         — paginated, search, sort
- `POST   /api/hosted-zones`                         — create + auto NS/SOA
- `GET    /api/hosted-zones/{id}`
- `PUT    /api/hosted-zones/{id}`                    — edit comment/type (name immutable)
- `DELETE /api/hosted-zones/{id}`

### DNS Records
- `GET    /api/hosted-zones/{id}/records`            — paginated, search, type filter, sort
- `POST   /api/hosted-zones/{id}/records`            — validated per type
- `PUT    /api/hosted-zones/{id}/records/{rid}`
- `DELETE /api/hosted-zones/{id}/records/{rid}`
- `DELETE /api/hosted-zones/{id}/records`            — bulk delete (body: `{ids:[...]}`)

### Export
- `GET    /api/hosted-zones/{id}/export`             — JSON export
- `GET    /api/hosted-zones/{id}/export/bind`        — BIND zone file export

### Stats
- `GET    /api/stats`

## Demo Account

The app seeds a demo user and sample hosted zones on first startup.

| Field    | Value             |
|----------|-------------------|
| Email    | demo@example.com  |
| Password | demo123 (or any)  |

The `demo@example.com` account has two pre-seeded zones: `example.com.` (Public) and `internal.example.com.` (Private) with six realistic DNS records.
