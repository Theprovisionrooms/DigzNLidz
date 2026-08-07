// Public "coming soon" gate. Runs in front of every request.
//
// While MAINTENANCE_MODE is "true", public visitors get the coming soon
// page instead of the real site, so the domain can be connected today
// without customers seeing an unfinished booking flow.
//
// What still works as normal, unaffected:
// - /api/*        Square OAuth, webhooks, bookings, everything backend.
//                  Danny needs the webhook + oauth callback URLs live now.
// - /dashboard*    Staff dashboard, already gated behind its own password.
// - /assets/*      So /dashboard and the coming soon page can load CSS/JS.
//
// Jordan/Mark/Danny can still preview the real site while it's gated by
// visiting any page once with ?preview=<MAINTENANCE_PREVIEW_KEY> in the URL,
// that sets a cookie for the rest of the session. This is its own separate
// secret, set independently from DASHBOARD_PASSWORD, specifically so a
// preview link shared in a text or left in someone's browser history never
// hands over the actual staff dashboard password. Set MAINTENANCE_PREVIEW_KEY
// as a Cloudflare Pages secret before sharing a preview link. Falls back to
// DASHBOARD_PASSWORD only if MAINTENANCE_PREVIEW_KEY hasn't been set yet, so
// existing preview links don't break before the new secret is added, this
// fallback should be removed once MAINTENANCE_PREVIEW_KEY is in place.
//
// To go fully live, set MAINTENANCE_MODE to "false" in Cloudflare Pages env
// vars (Production), no code change or redeploy needed.

const BYPASS_COOKIE = "dnl_preview";

// /booking-confirmed and /corporate-confirmed are where Square redirects
// a customer straight after they pay, so these need to work even while
// the rest of the public site is gated, whenever a payment link's gone
// out before MAINTENANCE_MODE flips off (corporate deposit links, for
// instance, since staff can already send those from /dashboard). Without
// this, a real customer who'd just paid landed on the coming soon page
// instead of their confirmation.
const ALWAYS_ALLOWED_PREFIXES = ["/api/", "/dashboard", "/kitchen", "/assets/", "/coming-soon.html", "/booking-confirmed", "/corporate-confirmed"];

export async function onRequest({ request, env, next }) {
  if (env.MAINTENANCE_MODE !== "true") {
    return next();
  }

  const url = new URL(request.url);

  if (ALWAYS_ALLOWED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return next();
  }

  // ?preview=<key> sets a cookie so the rest of the visit skips the gate.
  const previewKey = url.searchParams.get("preview");
  const expectedKey = env.MAINTENANCE_PREVIEW_KEY || env.DASHBOARD_PASSWORD;
  if (previewKey && expectedKey && previewKey === expectedKey) {
    const response = await next();
    response.headers.append(
      "Set-Cookie",
      `${BYPASS_COOKIE}=1; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${12 * 60 * 60}`
    );
    return response;
  }

  const cookieHeader = request.headers.get("Cookie") || "";
  if (cookieHeader.includes(`${BYPASS_COOKIE}=1`)) {
    return next();
  }

  const comingSoon = await env.ASSETS.fetch(new URL("/coming-soon.html", request.url));
  return new Response(comingSoon.body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}
