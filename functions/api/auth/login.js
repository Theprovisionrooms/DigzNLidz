// POST /api/auth/login
// Single shared password for the dashboard, set as env.DASHBOARD_PASSWORD.
// Not a customer-facing endpoint.

import { createSessionCookie, checkLoginLockout, recordFailedLogin, clearLoginAttempts } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  const lockedMinutes = await checkLoginLockout(request, env);
  if (lockedMinutes !== null) {
    return Response.json(
      { error: `Too many wrong attempts. Try again in ${lockedMinutes} minute${lockedMinutes === 1 ? "" : "s"}.` },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));

  if (!body.password || body.password !== env.DASHBOARD_PASSWORD) {
    await recordFailedLogin(request, env);
    return Response.json({ error: "incorrect password" }, { status: 401 });
  }

  await clearLoginAttempts(request, env);

  const cookie = await createSessionCookie(env);

  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}
