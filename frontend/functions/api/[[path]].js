// Proxies /api/* from the Pages origin through to the API on Render.
//
// The point of this is the refresh cookie. It is set SameSite=Strict, so the
// browser only sends it back to the same site that set it. If the page were on
// one host and the API on another, that cookie would never be returned and
// every session would die at the first refresh — and because .pages.dev is on
// the Public Suffix List, two *.pages.dev subdomains do not count as the same
// site either. Routing the API under the page's own origin sidesteps all of
// that: as far as the browser is concerned there is one host, the cookie is
// first-party, and Strict works as intended without a custom domain.
//
// Set API_ORIGIN in the Pages project to the Render service URL, e.g.
// https://fire-safety-records-api.onrender.com (no trailing path).

const BODYLESS = new Set(["GET", "HEAD"]);

export async function onRequest({ request, env }) {
  const apiOrigin = env.API_ORIGIN;
  if (!apiOrigin) {
    return Response.json(
      { error: { message: "API_ORIGIN is not configured for this Pages project" } },
      { status: 502 },
    );
  }

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, apiOrigin);

  const headers = new Headers(request.headers);
  // The upstream Host must be Render's, not the Pages hostname.
  headers.delete("host");
  // Without this the API sees Cloudflare's address and rate limits every
  // caller as though they were one client.
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: BODYLESS.has(request.method) ? undefined : request.body,
    // A redirect from the API is the browser's to follow, not ours.
    redirect: "manual",
  });

  // Returned unchanged, Set-Cookie included. The cookie carries no Domain, so
  // the browser scopes it to the host it believes served the response — this
  // origin — which is exactly what makes it first-party.
  return response;
}
