# FAZN Backend

Express + TypeScript backend for FAZN.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your local values
```

Run Postgres locally, then apply the initial migration:

```bash
psql "$DATABASE_URL" -f src/db/migrations/001_initial.sql
```

## Scripts

- `npm run dev` — start with hot reload on `src/`
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled server

## API Surface

- `GET /health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/users/me` (auth)
- `GET /api/v1/games` (public, active only)
- `POST /api/v1/admin/games` (admin)
- `DELETE /api/v1/admin/games/:id` (admin)

Auth: Bearer JWT access token (15m) + refresh token (7d).
