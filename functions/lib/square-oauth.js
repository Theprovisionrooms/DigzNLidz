// OAuth flow for Square, used in production instead of a static personal
// access token. Square requires this once an app is more than a one-off
// single-account integration, partner apps must not ask sellers for their
// personal access token.
// https://developer.squareup.com/docs/oauth-api/overview
//
// Sandbox testing is unaffected. getValidAccessToken() below falls straight
// back to the plain SQUARE_ACCESS_TOKEN env var whenever SQUARE_ENV isn't
// "production", so testing never depends on this being wired up.

const AUTHORIZE_BASE = "https://connect.squareup.com/oauth2/authorize";
const TOKEN_URL = "https://connect.squareup.com/oauth2/token";

// Matches what functions/lib/square.js actually calls: catalog read,
// payments, customers + cards (for card on file), and the merchant profile
// read the OAuth flow itself needs to confirm which account just connected.
const SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_WRITE",
  "PAYMENTS_READ",
  "ORDERS_WRITE",
  "ORDERS_READ",
  "CUSTOMERS_WRITE",
  "CUSTOMERS_READ",
  "ITEMS_READ",
];

function redirectUri(env) {
  return `${env.SITE_URL}/api/oauth/callback`;
}

// Builds the link that sends a staff member to Square's own "Allow access"
// screen. state is a random, one-time value the caller stores in a cookie
// and checks again in the callback, standard OAuth CSRF protection.
export function getAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id: env.SQUARE_APPLICATION_ID,
    scope: SCOPES.join(" "),
    session: "false", // always show the account picker, never silently reuse a signed-in Square session
    state,
    redirect_uri: redirectUri(env),
  });
  return `${AUTHORIZE_BASE}?${params.toString()}`;
}

// Swaps the one-time authorization code Square sends back to /api/oauth/callback
// for a real access token + refresh token.
export async function exchangeCodeForToken(env, code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SQUARE_APPLICATION_ID,
      client_secret: env.SQUARE_APPLICATION_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(env),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.errors?.[0]?.detail || data?.message || "Square OAuth token exchange failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    merchantId: data.merchant_id,
  };
}

async function refreshAccessToken(env, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SQUARE_APPLICATION_ID,
      client_secret: env.SQUARE_APPLICATION_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.errors?.[0]?.detail || data?.message || "Square OAuth token refresh failed");
  }
  return {
    accessToken: data.access_token,
    // Square doesn't always rotate the refresh token on every call, keep the
    // old one if a new one isn't sent back.
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_at,
    merchantId: data.merchant_id,
  };
}

export async function saveTokens(db, { accessToken, refreshToken, expiresAt, merchantId }) {
  await db
    .prepare(
      `INSERT INTO square_oauth (id, access_token, refresh_token, expires_at, merchant_id, updated_at)
       VALUES (1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         merchant_id = excluded.merchant_id,
         updated_at = excluded.updated_at`
    )
    .bind(accessToken, refreshToken, expiresAt, merchantId)
    .run();
}

export async function getStoredTokens(db) {
  const row = await db.prepare(`SELECT * FROM square_oauth WHERE id = 1`).first();
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    merchantId: row.merchant_id,
  };
}

// The one thing functions/lib/square.js actually calls. Sandbox keeps using
// the plain SQUARE_ACCESS_TOKEN env var exactly as before, so testing never
// depends on OAuth being connected. Production always goes through the
// stored OAuth token, refreshing it first if it's due to expire soon.
export async function getValidAccessToken(env) {
  if (env.SQUARE_ENV !== "production") {
    return env.SQUARE_ACCESS_TOKEN;
  }

  const stored = await getStoredTokens(env.DB);
  if (!stored) {
    throw new Error(
      "Square isn't connected yet. A staff member needs to log into /dashboard and click Connect to Square."
    );
  }

  const expiresInMs = new Date(stored.expiresAt).getTime() - Date.now();
  // Square access tokens last 30 days. Refresh a day early so a slow moment
  // never leaves a live payment mid-request with a token that just expired.
  if (expiresInMs > 24 * 60 * 60 * 1000) {
    return stored.accessToken;
  }

  const refreshed = await refreshAccessToken(env, stored.refreshToken);
  await saveTokens(env.DB, refreshed);
  return refreshed.accessToken;
}
