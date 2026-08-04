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
// visiting any page once with ?preview=<DASHBOARD_PASSWORD> in the URL,
// that sets a cookie for the rest of the session. No separate password to
// remember, reuses the existing staff one.
//
// To go fully live, set MAINTENANCE_MODE to "false" in Cloudflare Pages env
// vars (Production), no code change or redeploy needed.

const BYPASS_COOKIE = "dnl_preview";

const ALWAYS_ALLOWED_PREFIXES = ["/api/", "/dashboard", "/kitchen", "/assets/", "/coming-soon.html"];

export async function onRequest({ request, env, next }) {
  if (env.MAINTENANCE_MODE !== "true") {
    return next();
  }

  const url = new URL(request.url);

  if (ALWAYS_ALLOWED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return next();
  }

  // ?preview=<password> sets a cookie so the rest of the visit skips the gate.
  const previewKey = url.searchParams.get("preview");
  if (previewKey && env.DASHBOARD_PASSWORD && previewKey === env.DASHBOARD_PASSWORD) {
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
