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

// --- Login rate limiting -------------------------------------------------
// The dashboard has one shared password and no user accounts, so there's no
// account to lock, only the attempt itself. This tracks failed attempts per
// IP in D1 (see migrations/0017_login_attempts.sql) and locks that IP out
// for a short cooldown after too many wrong guesses in a row.

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

function clientIp(request) {
  // Cloudflare sets this on every request that reaches a Pages Function.
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

// Returns a minutes-remaining number if this IP is currently locked out,
// or null if it's fine to attempt a login.
export async function checkLoginLockout(request, env) {
  const ip = clientIp(request);
  const row = await env.DB.prepare(`SELECT * FROM login_attempts WHERE ip = ?`).bind(ip).first();
  if (!row || !row.locked_until) return null;

  const lockedUntil = new Date(row.locked_until).getTime();
  if (Date.now() < lockedUntil) {
    return Math.ceil((lockedUntil - Date.now()) / 60000);
  }
  return null;
}

// Call on a wrong password. Increments the fail count for this IP, resetting
// the window if the last failure was long enough ago, and sets a lockout
// once MAX_ATTEMPTS is reached inside WINDOW_MINUTES.
export async function recordFailedLogin(request, env) {
  const ip = clientIp(request);
  const now = new Date();
  const row = await env.DB.prepare(`SELECT * FROM login_attempts WHERE ip = ?`).bind(ip).first();

  const windowExpired = row && (now.getTime() - new Date(row.first_fail_at).getTime()) > WINDOW_MINUTES * 60000;

  if (!row || windowExpired) {
    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, fail_count, first_fail_at, locked_until)
       VALUES (?, 1, ?, NULL)
       ON CONFLICT(ip) DO UPDATE SET fail_count = 1, first_fail_at = excluded.first_fail_at, locked_until = NULL`
    ).bind(ip, now.toISOString()).run();
    return;
  }

  const failCount = row.fail_count + 1;
  const lockedUntil = failCount >= MAX_ATTEMPTS
    ? new Date(now.getTime() + LOCKOUT_MINUTES * 60000).toISOString()
    : null;

  await env.DB.prepare(
    `UPDATE login_attempts SET fail_count = ?, locked_until = ? WHERE ip = ?`
  ).bind(failCount, lockedUntil, ip).run();
}

// Call on a correct password, clears any history for this IP.
export async function clearLoginAttempts(request, env) {
  const ip = clientIp(request);
  await env.DB.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}
