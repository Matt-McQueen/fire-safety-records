// Waits until a deployment is serving a particular commit.
//
// Render, Vercel and Cloudflare Pages all deploy asynchronously: the push
// returns immediately and the new build arrives a minute or two later. Until
// it does, every URL still answers — with the previous build. A test suite
// started at the wrong moment therefore tests the thing it was meant to
// replace, and passes, which is the worst possible outcome for a check whose
// entire job is to decide whether a change is safe.
//
// This is the gate in front of that. It polls /api/health (and, for a Pages
// origin, the <meta name="app-commit"> stamped into index.html) until both
// report the expected commit, or gives up non-zero.
//
//   node wait-for-deploy.mjs --url https://staging.example.pages.dev \
//                            --commit $(git rev-parse HEAD)
//
//   --url      required. The origin to poll. Repeatable, for checking the API
//              origin and the public origin in the same run.
//   --commit   required. Full or short SHA; compared by prefix.
//   --timeout  seconds to keep trying. Default 600 — high because a free
//              Render instance that has spun down can take a minute to answer
//              the first request at all, on top of the deploy itself.
//   --interval seconds between attempts. Default 10.

const args = parseArgs(process.argv.slice(2));
const urls = args.url ?? [];
const commit = args.commit?.[0]?.trim();
const timeoutSeconds = Number(args.timeout?.[0] ?? 600);
const intervalSeconds = Number(args.interval?.[0] ?? 10);

if (urls.length === 0 || !commit) {
  console.error("usage: node wait-for-deploy.mjs --url <origin> --commit <sha> [--timeout 600]");
  process.exit(2);
}

const deadline = Date.now() + timeoutSeconds * 1000;
const pending = new Map(urls.map((url) => [url.replace(/\/+$/, ""), "not checked yet"]));

while (true) {
  for (const url of [...pending.keys()]) {
    const result = await check(url, commit);
    if (result.ok) {
      console.log(`${url} is serving ${commit}`);
      pending.delete(url);
    } else {
      pending.set(url, result.reason);
    }
  }

  if (pending.size === 0) {
    console.log("every origin is serving the expected commit.");
    process.exit(0);
  }

  if (Date.now() >= deadline) {
    console.error(`Gave up after ${timeoutSeconds}s. Still waiting on:`);
    for (const [url, reason] of pending) console.error(`  ${url}: ${reason}`);
    console.error(
      "\nCheck the platform's own deploy log before assuming this is wrong — a build" +
        "\nthat failed will keep serving the previous commit indefinitely.",
    );
    process.exit(1);
  }

  const remaining = Math.round((deadline - Date.now()) / 1000);
  for (const [url, reason] of pending) console.log(`waiting on ${url}: ${reason} (${remaining}s left)`);
  await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
}

// An origin is only accepted once everything it serves reports the commit. For
// the Pages origin that is both the API (through the proxy) and the HTML, which
// deploy independently and can briefly disagree.
async function check(origin, expected) {
  const api = await reportedByApi(origin);
  if (api.error) return { ok: false, reason: api.error };
  if (!matches(api.commit, expected)) {
    return { ok: false, reason: `API reports ${api.commit ?? "no commit"}` };
  }

  const html = await reportedByFrontend(origin);
  // An API-only origin (Render, Vercel) serves no HTML of ours, so there is
  // nothing to disagree with and the API's answer is the whole answer.
  if (html.absent) return { ok: true };
  if (!matches(html.commit, expected)) {
    return { ok: false, reason: `frontend reports ${html.commit || "no commit"}` };
  }
  return { ok: true };
}

async function reportedByApi(origin) {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { error: `GET /api/health returned ${response.status}` };
    const body = await response.json();
    return { commit: body?.commit ?? null };
  } catch (error) {
    return { error: error.message };
  }
}

async function reportedByFrontend(origin) {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(20_000) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("text/html")) return { absent: true };
    const html = await response.text();
    const stamped = html.match(/<meta name="app-commit" content="([^"]*)"/)?.[1];
    // No stamp at all means this origin does not serve our build of the
    // frontend — an API host with a landing page, most likely.
    if (stamped === undefined) return { absent: true };
    return { commit: stamped };
  } catch {
    return { absent: true };
  }
}

function matches(reported, expected) {
  if (!reported) return false;
  const [longer, shorter] =
    reported.length >= expected.length ? [reported, expected] : [expected, reported];
  return longer.startsWith(shorter);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const value = argv[i + 1]?.startsWith("--") ? "" : argv[++i];
    (parsed[name] ??= []).push(value);
  }
  return parsed;
}
