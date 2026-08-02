// GET /api/oauth/authorize
// Staff-facing. Starts the Square OAuth connection: sends the logged-in
// staff member to Square's own "Allow access" screen. Link this from a
// "Connect to Square" button in /dashboard, don't expose it publicly, it's
// gated on the same dashboard login as everything else in /api/dashboard.

import { isAuthenticated, unauthorizedResponse } from "../../lib/auth.js";
import { getAuthorizeUrl } from "../../lib/square-oauth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  if (env.SQUARE_ENV !== "production") {
    return Response.json(
      {
        error:
          "Sandbox uses SQUARE_ACCESS_TOKEN directly, there's nothing to connect. Set SQUARE_ENV=production to connect the real Square account.",
      },
      { status: 400 }
    );
  }

  const state = crypto.randomUUID();
  const url = getAuthorizeUrl(env, state);

  return new Response(null, {
    status: 302,
    headers: {
      "Location": url,
      // Short-lived, only needs to survive the round trip to Square and back.
      "Set-Cookie": `dnl_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}
