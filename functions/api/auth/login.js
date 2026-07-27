// POST /api/auth/login
// Single shared password for the dashboard, set as env.DASHBOARD_PASSWORD.
// Not a customer-facing endpoint.

import { createSessionCookie } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));

  if (!body.password || body.password !== env.DASHBOARD_PASSWORD) {
    return Response.json({ error: "incorrect password" }, { status: 401 });
  }

  const cookie = await createSessionCookie(env);

  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}
