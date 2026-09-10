# Database API Demo

A minimal full-stack demo: an Express + PostgreSQL REST API (`backend/`)
serving a small "items" CRUD resource, and a React (Vite) frontend
(`frontend/`) that consumes it.

## Prerequisites

- Node.js 18+
- A PostgreSQL instance (via `docker-compose up -d`, or any existing
  Postgres server — point `DATABASE_URL` at it)

## Setup

```bash
# start Postgres (requires Docker)
docker-compose up -d

# backend
cd backend
cp .env.example .env
npm install
npm run dev

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

The frontend dev server proxies `/api` requests to the backend on port
3001, so open the Vite URL it prints (typically http://localhost:5173).

If you don't have Docker, create the database and table manually and
set `DATABASE_URL` in `backend/.env` to point at it — the schema is in
`backend/src/db/init.sql`.

## API

| Method | Path             | Description       |
| ------ | ---------------- | ------------------ |
| GET    | `/api/items`      | List all items     |
| GET    | `/api/items/:id`  | Get one item        |
| POST   | `/api/items`      | Create an item      |
| PUT    | `/api/items/:id`  | Update an item      |
| DELETE | `/api/items/:id`  | Delete an item      |
