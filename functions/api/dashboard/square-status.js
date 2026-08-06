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
    // location_id was added in migration 0013, after this connection was
    // first made, so an existing token row can be connected fine and
    // still have no location_id stored (getLocationId in square.js falls
    // back to the SQUARE_LOCATION_ID env var in that case, which is safe,
    // but it means the fix that migration was for hasn't actually taken
    // effect yet). Nothing surfaced this distinction before, so there was
    // no way for staff to know a reconnect was still needed, the button
    // just disappears the moment connected is true regardless.
    locationId: tokens.locationId || null,
  });
}
