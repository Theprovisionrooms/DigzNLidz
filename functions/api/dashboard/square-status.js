// GET /api/dashboard/square-status
// Staff-facing. Lets the dashboard show whether Square is actually connected,
// rather than staff only finding out it isn't when a payment fails.

import { isAuthenticated, unauthorizedResponse } from "../../lib/auth.js";
import { getStoredTokens } from "../../lib/square-oauth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  if (env.SQUARE_ENV !== "production") {
    return Response.json({
      connected: true,
      mode: "sandbox",
      note: "Sandbox uses a static access token, no connection needed.",
    });
  }

  const tokens = await getStoredTokens(env.DB);
  if (!tokens) {
    return Response.json({ connected: false, mode: "production" });
  }

  return Response.json({
    connected: true,
    mode: "production",
    expiresAt: tokens.expiresAt,
  });
}
