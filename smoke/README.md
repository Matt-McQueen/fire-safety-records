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

### Why the API is allowed to be behind

Not every push produces a new build on every origin. `render.yaml` sets
`rootDir: backend`, and Render does not rebuild when a commit changes nothing
under that directory — so promoting a change to `e2e/`, to CI, or to a file at
the repository root moves the frontend and correctly leaves the API on the last
commit that did touch `backend/`.

The gate used to treat that as a deploy that had not landed. It waited the full
ten minutes for a build that was never coming, then failed the `Smoke`
workflow, and it did so on two consecutive promotions. The wasted ten minutes
was not the cost. The cost was that a red `Smoke` run on `main` stopped meaning
"production is wrong" and started meaning "one of two things, and you will have
to go and look" — and a gate that cries wolf is how the real wolf gets in.

[`deploy-scope.mjs`](deploy-scope.mjs) draws the line. An API origin not
serving the promoted commit is accepted only when both of these hold:

- the commit it *is* serving is an **ancestor** of the one being promoted, and
- **nothing under the API's build paths changed** in between.

An older commit off to one side of history, or an older commit with backend
changes since, is a deploy that failed or never ran, and is still refused —
those are what the gate is for. When it does accept an origin this way it says
so in its output rather than passing quietly.

Two deliberate asymmetries:

- **The frontend gets no such latitude.** Cloudflare Pages builds every commit
  on the branch it tracks regardless of which files changed, so a frontend
  still serving an older commit has no innocent explanation.
- **The build paths are read from `render.yaml`**, not restated here, so
  changing where the API builds from changes what the gate believes in the same
  commit.

Everything fails closed. No checkout, a shallow clone, no git, a blueprint it
cannot parse — any of those and no exemption is granted, so the gate behaves
exactly as it did before. Being too strict costs a red build on a healthy
deployment; being too lax costs a broken production that reports itself well,
and only one of those is recoverable by reading the log. This is why the
`Smoke` workflow checks out with `fetch-depth: 0`: without the history, the
gate cannot tell the two cases apart and will not guess.

## Testing the tests

```bash
cd smoke
npm run test:unit
```

Needs no deployment, no database and no credentials — it runs in about ten
seconds and CI runs it on every pull request. `npm test` still means "run
against a deployment", and always will.

`tests/stub-origin.mjs` is a deployment that answers however a test needs it
to, and every answer can be made wrong on purpose. That is the point. The two
spec files beside it spend most of their length breaking the stub one fault at
a time — records served without a token, a viewer who can reach the audit log,
a refresh cookie that lost `Secure`, a frontend still on the previous build —
and asserting that the suite goes red and names the right check.

Proving it passes against a healthy stub would be worth very little. A smoke
suite that *cannot* fail is worse than no smoke suite, because a green tick
from it is the last thing between a bad build and production, and everyone
believes it.

`wait-for-deploy.mjs` is run as a real process, because its exit code is its
interface. The case worth naming is an origin that alternates between the new
build and the old one: three consecutive agreements refuse it, and one probe
accepts it about half the time. Both are asserted, which is what keeps the fix
from being quietly undone.

Two things are worth knowing before adding to these:

- Only the two **commit** assertions in the suite retry. Everything else fails
  on the first wrong answer, and one test checks that an unauthenticated read
  is attempted exactly once — a 401 that only arrives on the third attempt is
  a broken deployment, not a slow one, and retrying it would turn a real
  failure into a flake.
- One test asserts that a whole run makes no request that is not a `GET`, apart
  from its own sign-in and sign-out. That is the property that allows any of
  this near production, so it is checked rather than assumed.

`SMOKE_SETTLE_SECONDS` shortens the commit retry window. It exists so those
tests can exercise the failing path in a second rather than a minute; unset,
which is every real run, it is a minute.
