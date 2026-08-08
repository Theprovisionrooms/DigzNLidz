// Square API client for Cloudflare Workers / Pages Functions.
// Raw fetch against Square's REST API rather than the Node SDK, since the SDK
// is not built for the Workers runtime.

import { getValidAccessToken, getStoredTokens } from "./square-oauth.js";

const API_VERSION = "2025-01-23";

// Sandbox: the plain SQUARE_LOCATION_ID env var, same as before, this
// only ever points at the sandbox test location so a hardcoded value is
// fine here. Production: reads the real location id Square handed back
// when the account was connected (see square-oauth.js), never the env
// var, so going live for real never depends on someone remembering to
// hand-update SQUARE_LOCATION_ID to match whichever account actually
// got connected.
//
// Falls back to the env var rather than hard-failing if nothing's
// stored yet, since a real production system could easily have been
// connected before this locationId capture existed (it did, here) - a
// stored row with no location on it shouldn't suddenly break every live
// payment the moment this deploys. It'll self-correct the next time
// someone clicks "Connect to Square" from /dashboard, which re-fetches
// and stores it properly, at which point this fallback stops being hit.
export async function getLocationId(env) {
  if (env.SQUARE_ENV !== "production") {
    return env.SQUARE_LOCATION_ID;
  }
  const stored = await getStoredTokens(env.DB);
  if (stored?.locationId) {
    return stored.locationId;
  }
  if (env.SQUARE_LOCATION_ID) {
    console.error(
      "Square is connected but no location_id is stored yet (connected before this was added), falling back to the SQUARE_LOCATION_ID env var. Click Connect to Square again in /dashboard to fix this properly."
    );
    return env.SQUARE_LOCATION_ID;
  }
  throw new Error(
    "Square isn't connected yet. A staff member needs to log into /dashboard and click Connect to Square."
  );
}

function baseUrl(env) {
  return env.SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

async function squareFetch(env, path, options = {}) {
  // Sandbox (testing): plain SQUARE_ACCESS_TOKEN env var, same as before.
  // Production: the OAuth token connected via /api/oauth/authorize, auto
  // refreshed. See functions/lib/square-oauth.js.
  const accessToken = await getValidAccessToken(env);

  const res = await fetch(`${baseUrl(env)}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Square-Version": API_VERSION,
      "Authorization": `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.errors?.[0]?.detail || "Square API error";
    throw new Error(message);
  }
  return data;
}

// Menu items, pulled from Square's catalog so Mark and Danny can manage
// pricing, items, AND photos themselves in Square without needing a code
// change or redeploy, same as pricing already works. types=ITEM,IMAGE in
// one call rather than two separate requests, IMAGE objects come back in
// the same list, matched to items below via item_data.image_ids.
export async function listMenuItems(env) {
  const data = await squareFetch(env, "/v2/catalog/list?types=ITEM,IMAGE", { method: "GET" });
  const objects = data.objects || [];

  const imageUrlById = Object.fromEntries(
    objects
      .filter((obj) => obj.type === "IMAGE" && obj.image_data?.url)
      .map((obj) => [obj.id, obj.image_data.url])
  );

  return objects
    .filter((obj) => obj.type === "ITEM")
    .map((obj) => {
      const variation = obj.item_data?.variations?.[0]?.item_variation_data;
      if (!variation?.price_money?.amount) return null;
      const imageId = obj.item_data?.image_ids?.[0];
      return {
        id: obj.id,
        name: obj.item_data.name,
        pricePence: variation.price_money.amount,
        imageUrl: imageId ? imageUrlById[imageId] || null : null,
      };
    })
    .filter(Boolean);
}

// Same fallback menu used by /api/config, kept here too so order endpoints
// can price-check against it without importing from functions/api (Pages
// Functions routes aren't meant to be imported from each other). No
// imageUrl, deliberately: this only ever shows up if the Square catalog
// fetch itself failed (see getMenu below), so the picker just renders
// these without a photo rather than pointing at a made-up path.
const FALLBACK_MENU = [
  { id: "squash", name: "Squash", pricePence: 150 },
  { id: "crisps", name: "Crisps", pricePence: 150 },
  { id: "hotdog", name: "Hot Dog", pricePence: 400 },
];

// The single source of truth for "what can be ordered and what it costs".
// /api/config uses this for display, and seats/[id]/order.js and
// tables/[id]/order.js use it again to re-price whatever the browser
// submits, so a tampered request body can never change what's actually
// charged. Never trust a client-supplied price, same rule bookings/index.js
// already follows for session pricing, this just applies it to food too.
export async function getMenu(env) {
  try {
    const catalogMenu = await listMenuItems(env);
    if (catalogMenu.length > 0) return catalogMenu;
  } catch (e) {
    console.error("Square catalog fetch failed, using fallback menu", e);
  }
  return FALLBACK_MENU;
}


// corporate payment links sent once staff confirm an enquiry.
export async function createPaymentLink(env, { amountPence, reference, description, redirectUrl }) {
  const data = await squareFetch(env, "/v2/online-checkout/payment-links", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: description,
        price_money: { amount: amountPence, currency: "GBP" },
        location_id: await getLocationId(env),
      },
      checkout_options: {
        redirect_url: redirectUrl,
      },
      payment_note: reference,
    }),
  });
  return {
    providerRef: data.payment_link.id,
    checkoutUrl: data.payment_link.url,
    orderId: data.payment_link.order_id,
  };
}

// Direct charge for the session extension. The seat page collects a card,
// Apple Pay, or Google Pay token client-side using the Square Web Payments
// SDK, and passes the resulting sourceId here so the customer never leaves
// the seat page.
export async function chargeSourceId(env, { sourceId, amountPence, reference, customerId }) {
  const data = await squareFetch(env, "/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      source_id: sourceId,
      amount_money: { amount: amountPence, currency: "GBP" },
      location_id: await getLocationId(env),
      note: reference,
      ...(customerId ? { customer_id: customerId } : {}),
    }),
  });
  return {
    providerRef: data.payment.id,
    status: data.payment.status, // COMPLETED, APPROVED, PENDING, FAILED
  };
}

export async function getPayment(env, paymentId) {
  const data = await squareFetch(env, `/v2/payments/${paymentId}`, { method: "GET" });
  return data.payment;
}

// --- Card on file ---
// Used so a seat session only has to collect card details once, extends
// and food/drink orders after that charge the saved card directly.

// A lightweight customer scoped to this seat visit, not a marketing
// contact, just something to attach a card on file to.
export async function createCustomer(env, { referenceId }) {
  const data = await squareFetch(env, "/v2/customers", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      reference_id: referenceId,
    }),
  });
  return data.customer.id;
}

// Saves the card used in a payment that's just gone through, so it can be
// reused for the rest of this visit without asking again.
export async function saveCardFromPayment(env, { paymentId, customerId }) {
  const data = await squareFetch(env, "/v2/cards", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      source_id: paymentId,
      card: { customer_id: customerId },
    }),
  });
  return data.card.id;
}

// Charges a card already on file. No card form, no re-entered details,
// just the amount and a reference.
export async function chargeCardOnFile(env, { customerId, cardId, amountPence, reference }) {
  const data = await squareFetch(env, "/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      source_id: cardId,
      customer_id: customerId,
      amount_money: { amount: amountPence, currency: "GBP" },
      location_id: await getLocationId(env),
      note: reference,
    }),
  });
  return {
    providerRef: data.payment.id,
    status: data.payment.status,
  };
}

// Best-effort cleanup once a seat session ends, so we're not holding onto
// a customer's card after they've left. Never throws, a Square hiccup here
// should never stop the seat freeing up for the next customer.
export async function disableCard(env, cardId) {
  try {
    await squareFetch(env, `/v2/cards/${cardId}/disable`, { method: "POST" });
  } catch (e) {
    console.error("Square disableCard failed", e);
  }
}

// Verifies the signature Square sends on webhook requests so payment
// confirmations can't be spoofed.
// https://developer.squareup.com/docs/webhooks/step3validate
//
// Square signs with HMAC-SHA256 (see the x-square-hmacsha256-signature
// header this gets compared against in square-webhook.js), this was
// importing the key as SHA-1 instead, a leftover from Square's old,
// deprecated v1 webhook signing scheme. That mismatch meant the computed
// signature could never match Square's real one, so every genuine
// webhook call was being rejected as invalid and silently dropped. In
// practice that meant standard bookings (paid via a Square payment link,
// not a direct card charge) never actually got marked paid, never sent
// their confirmation email, and never got an auto-held seat, even though
// the payment itself had gone through fine on Square's side.
export async function verifyWebhookSignature(env, { signature, body, notificationUrl }) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(notificationUrl + body)
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return computed === signature;
}
