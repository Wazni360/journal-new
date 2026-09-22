# Journal

Private, single-user video journal. Records in Chrome, keeps every chunk in IndexedDB until Cloudflare R2 has verified it, indexes metadata in Postgres. See `SPEC.md` for the full design.

## Setup

### 1. Postgres (Supabase)

1. Create a project. Note the database password.
2. Dashboard → Connect → **Session pooler** (port 5432). That URL is `DATABASE_URL`.

### 2. Cloudflare R2

1. Create a bucket. Leave public access off; do not enable an r2.dev domain.
2. R2 → Manage API tokens → create a token with **Object Read & Write**, scoped to this bucket only. Save the Access Key ID and Secret Access Key.
3. Your account ID is on the R2 overview page.
4. Bucket → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://<prod-domain>", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ["ETag"]` is required: without it the browser can't read part ETags and multipart uploads can't complete. Origins must match exactly, with no trailing slash. Add the port you actually use for local dev.

### 3. Environment

```sh
cp .env.example .env
```

Fill in the values. Generate the secrets:

```sh
echo "SESSION_SECRET=$(openssl rand -base64 32)"
echo "CRON_SECRET=$(openssl rand -hex 32)"
npm run hash-password -- "your password"      # prints APP_PASSWORD_HASH_B64=...
```

The password hash is base64-encoded because bcrypt hashes contain `$`, which `.env` loading would try to expand.

### 4. Database schema

```sh
npm install
npm run migrate
```

Migrations live in `db/migrations/` and run locally against `DATABASE_URL`. They never run during a Vercel build. `npm run migrate:make <name>` creates a new one.

### 5. Run

```sh
npm run dev
npm test
```

## Deploy (Vercel)

Set every variable from `.env.example` in the Vercel project's environment. Nothing else is required; `next build` does not touch the database or R2.

Rotating `SESSION_SECRET` signs out every device.

## Layout

- `app/` — pages and API route handlers. Every route handler verifies the session itself; `proxy.js` only redirects unauthenticated page loads to `/login`.
- `lib/config.js` — every tunable (recording constraints, codec candidates, upload part size).
- `lib/db.js`, `lib/r2.js`, `lib/session.js`, `lib/auth.js` — server-only modules. Each imports `server-only`.
- `db/migrations/` — Knex migrations.
- `scripts/` — `hash-password.js`, and later `rebuild-index.js`.
- `tests/` — Vitest.
