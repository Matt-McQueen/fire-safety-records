# Database API Demo

A minimal full-stack demo: an Express + PostgreSQL REST API (`backend/`)
serving a small "items" CRUD resource, and a React (Vite) frontend
(`frontend/`) that consumes it.

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier is enough)

## Setup

1. Create a Supabase project, then open its SQL Editor and run
   `backend/src/db/init.sql` to create the `items` table.
2. Copy the connection string from Project Settings -> Database ->
   Connection string (URI, "Transaction" pooler works well for a
   small app like this).

```bash
# backend
cd backend
cp .env.example .env   # paste the Supabase connection string into DATABASE_URL
npm install
npm run dev

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

The frontend dev server proxies `/api` requests to the backend on port
3001, so open the Vite URL it prints (typically http://localhost:5173).

`DATABASE_URL` also works against any other Postgres instance (local
or otherwise) — the pool only enables SSL when the host isn't
`localhost`/`127.0.0.1`.

## API

| Method | Path             | Description       |
| ------ | ---------------- | ------------------ |
| GET    | `/api/items`      | List all items     |
| GET    | `/api/items/:id`  | Get one item        |
| POST   | `/api/items`      | Create an item      |
| PUT    | `/api/items/:id`  | Update an item      |
| DELETE | `/api/items/:id`  | Delete an item      |
