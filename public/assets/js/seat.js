// Seat QR landing page.
// URL pattern: /seat/?seat=3

const seatId = new URLSearchParams(location.search).get("seat");
const app = document.getElementById("app");
document.getElementById("seat-title").textContent = seatId ? `Seat ${seatId}` : "Seat";

let config = null;
let squarePayments = null;
let pollTimer = null;

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
  render(data);
}

function render({ seat, session }) {
  if (seat.status === "free") return renderTierPicker();
  if (seat.status === "active") return renderActiveSession(session);
  if (seat.status === "awaiting_extension") return renderExtensionPrompt();
}

function renderTierPicker() {
  const rows = Object.entries(config.tiers).map(([key, tier]) => `
    <div class="tier-option">
      <div>
        <strong>${tier.name}</strong><br>
        <small>${tier.minutes} minutes${tier.pricePence > 0 ? ` — £${(tier.pricePence / 100).toFixed(2)}` : ""}</small>
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
    refresh();
    return;
  }

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
    refresh();
  });
}

function renderActiveSession(session) {
  clearInterval(window.__countdownInterval);
  app.innerHTML = `
    <div class="card">
      <h2>Session running</h2>
      <div class="timer" id="countdown">--:--</div>
    </div>
    ${renderMenu()}
  `;
  bindMenuHandlers();

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
    try {
      await collectCardAndSubmit(async (sourceId) => {
        const res = await fetch(`/api/seats/${seatId}/extend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Payment failed");
        }
        refresh();
      });
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });

  document.getElementById("extend-no").addEventListener("click", () => {
    app.innerHTML = `<div class="card"><h2>Thanks for playing</h2><p>Scan again any time to start a new session.</p></div>`;
    clearInterval(pollTimer);
  });
}

// Renders a Square card element into #card-container and resolves with a
// sourceId once the customer submits, or rejects on failure.
async function collectCardAndSubmit(onToken) {
  const container = document.getElementById("card-container");
  container.innerHTML = "";
  const card = await squarePayments.card();
  await card.attach("#card-container");

  const payBtn = document.createElement("button");
  payBtn.textContent = "Pay";
  container.after(payBtn);

  return new Promise((resolve, reject) => {
    payBtn.addEventListener("click", async () => {
      payBtn.disabled = true;
      payBtn.textContent = "Processing...";
      try {
        const result = await card.tokenize();
        if (result.status !== "OK") throw new Error("Card details not accepted");
        await onToken(result.token);
        resolve();
      } catch (e) {
        payBtn.disabled = false;
        payBtn.textContent = "Pay";
        reject(e);
      }
    });
  });
}

// --- Food & drink ordering ---
// Menu is placeholder until Digz N' Lidz confirm items and pricing.
const MENU = [
  { id: "squash", name: "Squash", pricePence: 150 },
  { id: "crisps", name: "Crisps", pricePence: 150 },
  { id: "hotdog", name: "Hot Dog", pricePence: 400 },
];

const cart = {};

function renderMenu() {
  const rows = MENU.map((item) => `
    <div class="item-row">
      <div>${item.name} — £${(item.pricePence / 100).toFixed(2)}</div>
      <div class="qty-controls">
        <button data-item="${item.id}" data-dir="-1">-</button>
        <span id="qty-${item.id}">0</span>
        <button data-item="${item.id}" data-dir="1">+</button>
      </div>
    </div>
  `).join("");

  return `
    <div class="card">
      <h2>Order to your seat</h2>
      ${rows}
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
    });
  });

  document.getElementById("order-submit").addEventListener("click", async () => {
    const items = MENU.filter((m) => cart[m.id] > 0).map((m) => ({
      name: m.name, quantity: cart[m.id], pricePence: m.pricePence,
    }));
    const errorEl = document.getElementById("order-error");
    if (items.length === 0) {
      errorEl.textContent = "Add something to your order first.";
      return;
    }
    const orderContainer = document.getElementById("order-container");
    orderContainer.id = "card-container"; // reuse card mount point
    try {
      await collectCardAndSubmit(async (sourceId) => {
        const res = await fetch(`/api/seats/${seatId}/order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, sourceId }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Order failed");
        }
        errorEl.textContent = "";
        errorEl.style.color = "var(--yellow)";
        errorEl.textContent = "Order placed, on its way!";
      });
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}

init();
