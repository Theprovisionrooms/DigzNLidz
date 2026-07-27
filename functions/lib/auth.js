// Lightweight dashboard auth. One shared password (env.DASHBOARD_PASSWORD),
// no user accounts, this is an internal tool for Digz N' Lidz and Jordan
// only, not customer-facing. Issues a signed, expiring cookie on login and
// verifies it on every dashboard API call.

const COOKIE_NAME = "dnl_session";
const SESSION_HOURS = 12;

async function sign(env, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.DASHBOARD_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/=+$/, "");
}

export async function createSessionCookie(env) {
  const expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `${expires}`;
  const signature = await sign(env, payload);
  const token = `${payload}.${signature}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
}

export async function isAuthenticated(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const [payload, signature] = match[1].split(".");
  if (!payload || !signature) return false;

  const expected = await sign(env, payload);
  if (expected !== signature) return false;

  return Number(payload) > Date.now();
}

export function unauthorizedResponse() {
  return Response.json({ error: "not authenticated" }, { status: 401 });
}
