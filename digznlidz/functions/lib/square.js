// Square API client for Cloudflare Workers / Pages Functions.
// Raw fetch against Square's REST API rather than the Node SDK, since the SDK
// is not built for the Workers runtime.

const API_VERSION = "2025-01-23";

function baseUrl(env) {
  return env.SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

async function squareFetch(env, path, options = {}) {
  const res = await fetch(`${baseUrl(env)}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Square-Version": API_VERSION,
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
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

// Hosted checkout page, used for deposits (family/group booking) and for
// corporate payment links sent once staff confirm an enquiry.
export async function createPaymentLink(env, { amountPence, reference, description, redirectUrl }) {
  const data = await squareFetch(env, "/v2/online-checkout/payment-links", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: description,
        price_money: { amount: amountPence, currency: "GBP" },
        location_id: env.SQUARE_LOCATION_ID,
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
export async function chargeSourceId(env, { sourceId, amountPence, reference }) {
  const data = await squareFetch(env, "/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      source_id: sourceId,
      amount_money: { amount: amountPence, currency: "GBP" },
      location_id: env.SQUARE_LOCATION_ID,
      note: reference,
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

// Verifies the signature Square sends on webhook requests so payment
// confirmations can't be spoofed.
// https://developer.squareup.com/docs/webhooks/step3validate
export async function verifyWebhookSignature(env, { signature, body, notificationUrl }) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: "HMAC", hash: "SHA-1" },
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
