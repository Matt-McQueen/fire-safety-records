# Smoke tests

Read-only checks against a deployed environment. **This is the only suite that
may be pointed at production.**

`backend/tests` and `e2e/` both create premises, people and accounts directly
in the database and remove them afterwards. That is the right trade for a
disposable environment and the wrong one for a live database holding personal
data: an interrupted run leaves real-looking records behind. Nothing here
writes anything — every request is a GET, apart from the sign-in the
authorised checks need and the sign-out that returns the session at the end.

What it proves:

- the API is up, and is the build and the environment this run is aimed at
- the frontend is served, and is the same commit
- the Pages function proxying `/api/*` reaches the API
- records cannot be read without a token, and a viewer cannot reach the
  admin-only audit log
- the refresh cookie comes back `HttpOnly`, `Secure` and `SameSite=Strict` —
  configuration that no local run can check, because a Secure cookie is never
  sent over plain HTTP in the first place
- the compliance summary computes, which is the one read that crosses several
  tables and so notices a migration that did not land

What it does not prove: any business rule. Those are settled before a change
is promoted, by the suites that are allowed to write.

## Running

```bash
cd smoke
SMOKE_WEB_URL=https://staging.fire-safety-records.pages.dev npm test
```

| Variable | | |
|---|---|---|
| `SMOKE_WEB_URL` | required | The public origin. Everything is driven through this rather than the API's own hostname, because it is the path a real user takes. |
| `SMOKE_API_URL` | optional | The API's own origin (Render, Vercel). Checked as well when set, which separates "the API is down" from "the proxy in front of it is misconfigured". |
| `SMOKE_EMAIL`, `SMOKE_PASSWORD` | optional | A **viewer-role** account. Without them the signed-in checks skip, and about half the value of the suite goes with them. |
| `SMOKE_COMMIT` | optional | The commit this deploy was meant to be. Both the API and the frontend must report it. |
| `SMOKE_ENVIRONMENT` | optional | `production` or `staging`; the API must agree. Worth setting for production — it is what catches a URL aimed at the wrong environment. |

### The smoke account

Create one per environment, viewer role, granted no premises at all:

```bash
cd backend
npm run auth:user -- --email smoke@example.com --role viewer
```

A viewer with no premises can read nothing but the endpoints the suite
actually checks, so the credentials in CI are worth as little as credentials
can be while still proving that sign-in works.

## Waiting for a deploy first

A push returns before the deploy lands, and until it does the old build keeps
answering — so a suite started too early tests the build it was meant to
replace, and passes. Gate on the commit:

```bash
node wait-for-deploy.mjs --url https://staging.fire-safety-records.pages.dev --commit $(git rev-parse HEAD)
```

It polls `/api/health` and the `<meta name="app-commit">` stamped into
`index.html` until both report that commit **three times running**, then exits
0. Pass `--url` more than once to wait on the API origin and the public origin
together. It gives up after ten minutes: a build that *failed* will serve the
previous commit indefinitely, so check the platform's deploy log before
assuming the check is at fault.

The repeated agreement is the point. A rollout is eventually consistent —
Cloudflare Pages serves from many edge nodes and they do not switch together,
so one request can be answered by a node that has the new build and the next by
one that has not. An earlier version of this script accepted a single
successful probe, and on one promotion it announced "every origin is serving
the expected commit" seconds before the smoke suite found the frontend still on
the previous one. Neither observation was wrong; the gate was. Three
confirmations spaced ten seconds apart is not proof either — nothing short of
asking every node is — but it is the difference between catching a rollout
mid-flight and catching it by luck. `--confirmations` tunes it.

For the same reason the suite's two commit assertions retry for a minute before
failing, while every other assertion in it fails on the first wrong answer:
those are asserting behaviour, where one wrong answer is one too many.
