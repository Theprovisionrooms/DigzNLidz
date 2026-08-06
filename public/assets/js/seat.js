// Seat QR landing page.
// URL pattern: /seat/?seat=3

const seatId = new URLSearchParams(location.search).get("seat");
const app = document.getElementById("app");
document.getElementById("seat-title").textContent = seatId ? `Seat ${seatId}` : "Seat";

// Per-session secret, see migration 0016. Set once start.js or
// redeem-held.js hands one back, sent on every extend/order/end call so
// this seat's session can only be acted on from the browser that
// actually started it. localStorage rather than sessionStorage: a guest
// backgrounding or closing their phone browser mid-visit and coming back
// shouldn't get locked out of their own still-active session. An old
// token left over from a previous visit is harmless either way, once a
// seat starts a new session the old token just stops matching.
//
// Group sessions use one shared code instead of a per-seat token (see
// group/start.js), so this falls back to a device-wide code if there's
// no per-seat token, that's what lets a code entered once on this phone
// keep working across any of the group's seats without asking again.
function getSessionToken() {
  return localStorage.getItem(`dnl_token_${seatId}`) || localStorage.getItem("dnl_group_code") || null;
}
function setSessionToken(token) {
  if (!token) return;
  localStorage.setItem(`dnl_token_${seatId}`, token);
  localStorage.setItem("dnl_group_code", token);
}

// extend/order/end all need a session token, and any of them can come
// back "this session isn't yours" the first time a device touches a
// staff-assigned or group seat, that's expected, not an error, it just
// means this device doesn't have the right token yet. For a staff-claimed
// seat there's nothing to enter, claim-on-first-touch handles it
// server-side. For a group seat, prompt once for the table code and
// retry, then remember it for every other seat this device touches.
async function postWithToken(url, body) {
  const attempt = async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, sessionToken: getSessionToken() }),
    });
    return res;
  };

  let res = await attempt();
  if (res.status === 403) {
    const code = window.prompt("Enter your table code to order or extend from this seat:");
    if (code) {
      localStorage.setItem(`dnl_token_${seatId}`, code.trim());
      localStorage.setItem("dnl_group_code", code.trim());
      res = await attempt();
    }
  }
  return res;
}

let config = null;
let squarePayments = null;
let pollTimer = null;
let currentSession = null;

// True while a Square card form is mounted and waiting on the customer,
// i.e. the tier picker's payment step, an extension charge, or an order
// with no card on file yet. refresh() skips re-rendering while this is
// true so the 5-second poll can't blow away a card form mid-entry, that
// used to happen if someone took more than 5 seconds to type their card
// details, the whole screen would get wiped from under them.
let cardFormActive = false;

async function loadSquareSdk(env) {
  return new Promise((resolve, reject) => {
    const src = env === "production"
      ? "https://web.squarecdn.com/v1/square.js"
      : "https://sandbox.web.squarecdn.com/v1/square.js";
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function init() {
  if (!seatId) {
    app.innerHTML = `<div class="card error">No seat number in the link. Ask a member of staff to help.</div>`;
    return;
  }

  const configRes = await fetch("/api/config");
  config = await configRes.json();

  await loadSquareSdk(config.squareEnv);
  squarePayments = window.Square.payments(config.squareApplicationId, config.squareLocationId);

  await refresh();
  pollTimer = setInterval(refresh, 5000);
}

async function refresh() {
  const res = await fetch(`/api/seats/${seatId}`);
  const data = await res.json();
  currentSession = data.session;
  if (cardFormActive) return; // don't tear down an open card form while someone's using it
  render(data);
}

function render({ seat, session }) {
  if (seat.status === "free") return renderTierPicker();
  if (seat.status === "held") return renderHeldConfirm(seat);
  if (seat.status === "active") return renderActiveSession(session);
  if (seat.status === "awaiting_extension") return renderExtensionPrompt();
  if (seat.status === "starting") {
    // Someone else's scan of this exact seat is mid-payment right now,
    // this only ever shows briefly. Just wait for the next poll.
    app.innerHTML = `<div class="card"><p>Someone's just starting a session here, one moment...</p></div>`;
  }
}

// A seat shows "held" once it's auto-pinned to a paid booking ahead of
// their slot (see workers/session-expiry-cron.js). Holds are by tier
// (session length), not by named person, so on a mixed-tier family
// booking any of them could scan any held seat. Rather than guess,
// show what length this particular seat is holding and let the guest
// confirm it's theirs before it starts, if it's wrong they just try a
// different held seat, nothing to undo.
function renderHeldConfirm(seat) {
  clearInterval(window.__countdownInterval);
  const tier = config?.tiers?.[seat.held_tier];
  const label = tier ? tier.name : "a session";

  app.innerHTML = `
    <div class="card">
      <h2>Seat held for a booking</h2>
      <p>This seat's booked for <strong>${label}</strong>. If that's your session length, confirm below and it'll start straight away. If not, this seat isn't assigned to a specific person, try another held seat instead.</p>
      <button id="held-confirm-btn">Yes, start my session</button>
      <button id="held-cancel-btn" class="secondary">Not this one</button>
    </div>
  `;

  document.getElementById("held-confirm-btn").addEventListener("click", redeemHeld);
  document.getElementById("held-cancel-btn").addEventListener("click", () => {
    app.innerHTML = `<div class="card"><p>No problem, scan a different seat that matches your session length.</p></div>`;
  });
}

let redeemInFlight = false;
async function redeemHeld() {
  if (redeemInFlight) return;
  redeemInFlight = true;
  app.innerHTML = `<div class="card"><h2>Starting your session...</h2></div>`;
  try {
    const res = await fetch(`/api/seats/${seatId}/redeem-held`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      app.innerHTML = `<div class="card error">${err.error || "Couldn't start your session, ask a member of staff to help."}</div>`;
      return;
    }
    const data = await res.json();
    setSessionToken(data.sessionToken);
  } catch (e) {
    app.innerHTML = `<div class="card error">Couldn't start your session, ask a member of staff to help.</div>`;
    return;
  } finally {
    redeemInFlight = false;
  }
  refresh();
}

function renderTierPicker() {
  const rows = Object.entries(config.tiers).map(([key, tier]) => `
    <div class="tier-option">
      <div>
        <strong>${tier.name}</strong><br>
        <small>${tier.minutes} minutes${tier.pricePence > 0 ? ` · £${(tier.pricePence / 100).toFixed(2)}` : ""}</small>
      </div>
      <button data-tier="${key}" class="start-tier-btn" style="width:auto;">Start</button>
    </div>
  `).join("");

  app.innerHTML = `
    <div class="card">
      <h2>Choose your session</h2>
      ${rows}
    </div>
    <div id="card-container"></div>
    <div id="tier-error" class="error"></div>
  `;

  document.querySelectorAll(".start-tier-btn").forEach((btn) => {
    btn.addEventListener("click", () => startTier(btn.dataset.tier));
  });
}

async function startTier(tierKey) {
  const tier = config.tiers[tierKey];
  const errorEl = document.getElementById("tier-error");
  errorEl.textContent = "";

  if (tier.pricePence === 0) {
    const res = await fetch(`/api/seats/${seatId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: tierKey }),
    });
    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || "Something went wrong, try again.";
      return;
    }
    const data = await res.json();
    setSessionToken(data.sessionToken);
    refresh();
    return;
  }

  try {
    await collectCardAndSubmit(async (sourceId) => {
      const res = await fetch(`/api/seats/${seatId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierKey, sourceId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Payment failed");
      }
      const data = await res.json();
      setSessionToken(data.sessionToken);
      refresh();
    }, tier.pricePence);
  } catch (e) {
    errorEl.textContent = e.message;
  }
}

function renderActiveSession(session) {
  clearInterval(window.__countdownInterval);
  app.innerHTML = `
    <div class="card">
      <h2>Session running</h2>
      <div class="timer" id="countdown">--:--</div>
      <button id="finish-early-btn" class="secondary">I'm finished</button>
    </div>
    ${renderMenu()}
  `;
  bindMenuHandlers();

  document.getElementById("finish-early-btn").addEventListener("click", endSession);

  const endsAt = new Date(session.ends_at).getTime();
  function tick() {
    const remainingMs = endsAt - Date.now();
    const el = document.getElementById("countdown");
    if (!el) return;
    if (remainingMs <= 0) {
      el.textContent = "TIME'S UP";
      clearInterval(window.__countdownInterval);
      refresh();
      return;
    }
    const mins = Math.floor(remainingMs / 60000);
    const secs = Math.floor((remainingMs % 60000) / 1000);
    el.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  tick();
  window.__countdownInterval = setInterval(tick, 1000);
}

function renderExtensionPrompt() {
  clearInterval(window.__countdownInterval);
  const price = (config.extension.pricePence / 100).toFixed(2);
  const cardOnFile = !!currentSession?.cardOnFile;

  app.innerHTML = `
    <div class="card">
      <h2>Time's up</h2>
      <p>Add ${config.extension.minutes} more minutes for £${price}?</p>
      <button id="extend-yes">Yes, add £${price}</button>
      <button id="extend-no" class="secondary">No, I'm done</button>
    </div>
    <div id="card-container"></div>
    <div id="extend-error" class="error"></div>
  `;

  document.getElementById("extend-yes").addEventListener("click", async () => {
    const errorEl = document.getElementById("extend-error");
    errorEl.textContent = "";
    try {
      if (cardOnFile) {
        // Card already on file for this visit, one tap, no form.
        const res = await postWithToken(`/api/seats/${seatId}/extend`, {});
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Payment failed");
        }
        const data = await res.json();
        setSessionToken(data.sessionToken);
        refresh();
      } else {
        await collectCardAndSubmit(async (sourceId) => {
          const res = await postWithToken(`/api/seats/${seatId}/extend`, { sourceId });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Payment failed");
          }
          const data = await res.json();
          setSessionToken(data.sessionToken);
          refresh();
        }, config.extension.pricePence);
      }
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });

  document.getElementById("extend-no").addEventListener("click", endSession);
}

// Ends the visit: frees the seat for the next scan and disables any card
// on file for this session, server-side.
async function endSession() {
  clearInterval(pollTimer);
  clearInterval(window.__countdownInterval);
  app.innerHTML = `<div class="card"><h2>Thanks for playing</h2><p>Scan again any time to start a new session.</p></div>`;
  try {
    await fetch(`/api/seats/${seatId}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: getSessionToken() }),
    });
  } catch (e) {
    // Seat page already shows the thank-you message either way, this is
    // just cleanup, no need to surface a network hiccup to the customer.
    console.error("end session failed", e);
  }
}

// Renders whichever of Apple Pay, Google Pay, and the card form the
// customer's device actually supports into #card-container, and resolves
// with a sourceId once one of them goes through (or rejects on the first
// failure, same as before - the button that failed stays live so they can
// just try again without collectCardAndSubmit being called a second time).
// amountPence is passed through to Square for SCA verification and shown
// as the total on the Apple Pay/Google Pay sheet.
//
// Every call site (tier start, extension, food order) already just wants
// "a sourceId, however they choose to pay", so nothing downstream of
// onToken needed to change for this.
async function collectCardAndSubmit(onToken, amountPence) {
  const container = document.getElementById("card-container");
  container.innerHTML = "";
  cardFormActive = true;

  const amount = (amountPence / 100).toFixed(2);
  const paymentRequest = squarePayments.paymentRequest({
    countryCode: "GB",
    currencyCode: "GBP",
    total: { amount, label: "Digz N' Lidz" },
  });

  const walletsEl = document.createElement("div");
  walletsEl.className = "wallet-buttons";
  container.appendChild(walletsEl);

  return new Promise((resolve, reject) => {
    let settled = false;

    // Shared by every method: a successful tokenize hands its sourceId to
    // onToken, and only the first method to get all the way through
    // settles the outer promise, whichever the customer actually used.
    const finish = async (sourceId, onFail) => {
      try {
        await onToken(sourceId);
        if (!settled) {
          settled = true;
          resolve();
        }
      } catch (e) {
        onFail();
        if (!settled) {
          settled = true;
          reject(e);
        }
      }
    };

    // --- Apple Pay --- Safari/iOS only. If it's not available (any other
    // browser, or the domain verification file isn't live yet) Square's
    // SDK throws here, so it just quietly doesn't show the button rather
    // than erroring the whole payment step.
    (async () => {
      try {
        const applePay = await squarePayments.applePay(paymentRequest);
        const btn = document.createElement("button");
        btn.textContent = " Pay";
        btn.className = "wallet-btn apple-pay-btn";
        walletsEl.appendChild(btn);
        btn.addEventListener("click", async () => {
          cardFormActive = false;
          btn.disabled = true;
          try {
            const result = await applePay.tokenize();
            if (result.status !== "OK") throw new Error("Apple Pay didn't go through, try again.");
            await finish(result.token, () => { btn.disabled = false; });
          } catch (e) {
            cardFormActive = true;
            btn.disabled = false;
            if (!settled) { settled = true; reject(e); }
          }
        });
      } catch (e) {
        // Not available on this device, nothing to show.
      }
    })();

    // --- Google Pay --- Square's SDK draws its own branded button once
    // attached; same not-available handling as Apple Pay above.
    (async () => {
      try {
        const googlePay = await squarePayments.googlePay(paymentRequest);
        const mount = document.createElement("div");
        mount.className = "wallet-btn";
        walletsEl.appendChild(mount);
        await googlePay.attach(mount);
        mount.addEventListener("click", async (e) => {
          e.preventDefault();
          cardFormActive = false;
          try {
            const result = await googlePay.tokenize();
            if (result.status !== "OK") throw new Error("Google Pay didn't go through, try again.");
            await finish(result.token, () => {});
          } catch (err) {
            cardFormActive = true;
            if (!settled) { settled = true; reject(err); }
          }
        });
      } catch (e) {
        // Not available on this device, nothing to show.
      }
    })();

    // --- Card --- always available, same form as before, just moved
    // below the wallet buttons so a one-tap option leads when there is one.
    (async () => {
      const divider = document.createElement("div");
      divider.className = "wallet-divider";
      divider.textContent = "Or pay by card";
      container.appendChild(divider);

      const cardMount = document.createElement("div");
      container.appendChild(cardMount);
      const card = await squarePayments.card();
      await card.attach(cardMount);

      const payBtn = document.createElement("button");
      payBtn.textContent = "Pay";
      cardMount.after(payBtn);

      payBtn.addEventListener("click", async () => {
        cardFormActive = false;
        payBtn.disabled = true;
        payBtn.textContent = "Processing...";
        try {
          const result = await card.tokenize({
            amount,
            currencyCode: "GBP",
            intent: "CHARGE",
            customerInitiated: true,
            sellerKeyedIn: false,
          });
          if (result.status !== "OK") throw new Error("Card details not accepted");
          await finish(result.token, () => {
            payBtn.disabled = false;
            payBtn.textContent = "Pay";
          });
        } catch (e) {
          cardFormActive = true;
          payBtn.disabled = false;
          payBtn.textContent = "Pay";
          if (!settled) { settled = true; reject(e); }
        }
      });
    })();
  });
}

// --- Food & drink ordering ---
// Menu comes from config.menu, populated server-side from Square's catalog
// (see functions/api/config.js), so Mark and Danny manage items and
// pricing themselves in Square without needing a code change.
const cart = {};

// Basket total pence, from the same config.menu/cart the customer's
// looking at. Display only, purely cosmetic, the server always re-prices
// from its own copy of the menu before charging anything (see order.js).
function basketTotalPence() {
  return config.menu
    .filter((m) => cart[m.id] > 0)
    .reduce((sum, m) => sum + m.pricePence * cart[m.id], 0);
}

function renderMenu() {
  const rows = config.menu.map((item) => `
    <div class="item-row">
      <div>${item.name} · £${(item.pricePence / 100).toFixed(2)}</div>
      <div class="qty-controls">
        <button data-item="${item.id}" data-dir="-1">-</button>
        <span id="qty-${item.id}">${cart[item.id] || 0}</span>
        <button data-item="${item.id}" data-dir="1">+</button>
      </div>
    </div>
  `).join("");

  return `
    <div class="card">
      <h2>Order to your seat</h2>
      ${rows}
      <div class="basket-total"><span>Total</span><span id="basket-total-amount">£${(basketTotalPence() / 100).toFixed(2)}</span></div>
      <button id="order-submit">Order</button>
      <div id="order-container"></div>
      <div id="order-error" class="error"></div>
    </div>
  `;
}

function bindMenuHandlers() {
  document.querySelectorAll(".qty-controls button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.item;
      const dir = Number(btn.dataset.dir);
      cart[id] = Math.max(0, (cart[id] || 0) + dir);
      document.getElementById(`qty-${id}`).textContent = cart[id];
      document.getElementById("basket-total-amount").textContent = `£${(basketTotalPence() / 100).toFixed(2)}`;
    });
  });

  document.getElementById("order-submit").addEventListener("click", async () => {
    const items = config.menu.filter((m) => cart[m.id] > 0).map((m) => ({
      id: m.id, quantity: cart[m.id],
    }));
    const errorEl = document.getElementById("order-error");
    if (items.length === 0) {
      errorEl.textContent = "Add something to your order first.";
      return;
    }

    // Shown to the customer for the card form's amount only, the server
    // re-prices every item itself before charging anything.
    const totalPence = basketTotalPence();
    const cardOnFile = !!currentSession?.cardOnFile;

    try {
      if (cardOnFile) {
        // Card already on file for this visit, place the order straight away.
        const res = await postWithToken(`/api/seats/${seatId}/order`, { items });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Order failed");
        }
        const data = await res.json();
        setSessionToken(data.sessionToken);
        for (const key in cart) cart[key] = 0;
        errorEl.style.color = "var(--yellow)";
        errorEl.textContent = "Order placed, on its way!";
        app.innerHTML = renderMenu();
        bindMenuHandlers();
        document.getElementById("order-error").style.color = "var(--yellow)";
        document.getElementById("order-error").textContent = "Order placed, on its way!";
      } else {
        const orderContainer = document.getElementById("order-container");
        orderContainer.id = "card-container"; // reuse card mount point
        await collectCardAndSubmit(async (sourceId) => {
          const res = await postWithToken(`/api/seats/${seatId}/order`, { items, sourceId });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Order failed");
          }
          const data = await res.json();
          setSessionToken(data.sessionToken);
          for (const key in cart) cart[key] = 0;
        }, totalPence);
        // A card was saved on file by this order (see order.js), so from
        // here on refresh() will pick up cardOnFile=true and future
        // orders skip straight to the fast path above.
        app.innerHTML = renderMenu();
        bindMenuHandlers();
        document.getElementById("order-error").style.color = "var(--yellow)";
        document.getElementById("order-error").textContent = "Order placed, on its way!";
      }
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}

init();
