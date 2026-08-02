// GET /api/oauth/callback
// Square redirects here after a staff member approves (or declines) the
// connection on Square's own screen. Not something anyone links to directly.
// Must match the redirect URI on file for this app in the Square Developer
// Dashboard exactly, including https, or Square will reject the request.

import { exchangeCodeForToken, saveTokens } from "../../lib/square-oauth.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`Square declined the connection: ${error}`, { status: 400 });
  }

  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/dnl_oauth_state=([^;]+)/);
  const cookieState = match?.[1];

  // Same check auth.js's session cookie exists for, confirms this callback
  // really followed on from an authorize request we just made, not someone
  // replaying an old link.
  if (!code || !state || !cookieState || state !== cookieState) {
    return new Response(
      "That connection attempt has expired or wasn't started from the dashboard. Go back to /dashboard and click Connect to Square again.",
      { status: 400 }
    );
  }

  try {
    const tokens = await exchangeCodeForToken(env, code);
    await saveTokens(env.DB, tokens);
  } catch (e) {
    console.error("Square OAuth token exchange failed", e);
    return new Response(
      "Couldn't finish connecting to Square. Check the Cloudflare Pages logs, then try again from the dashboard.",
      { status: 500 }
    );
  }

  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/dashboard/?square=connected",
      "Set-Cookie": "dnl_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    },
  });
}
