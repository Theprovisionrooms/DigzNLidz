// Cafe table QR landing page. Food and drink ordering only, no RC
// session attached. URL pattern: /table/?table=5

const tableId = new URLSearchParams(location.search).get("table");
const app = document.getElementById("app");
document.getElementById("table-title").textContent = tableId ? `Table ${tableId}` : "Table";

let config = null;
let squarePayments = null;
const cart = {};

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
  if (!tableId) {
    app.innerHTML = `<div class="card error">No table number in the link. Ask a member of staff to help.</div>`;
    return;
  }

  const configRes = await fetch("/api/config");
  config = await configRes.json();

  await loadSquareSdk(config.squareEnv);
  squarePayments = window.Square.payments(config.squareApplicationId, config.squareLocationId);

  render();
}

function render() {
  const rows = config.menu.map((item) => `
    <div class="item-row">
      <div>${item.name} · £${(item.pricePence / 100).toFixed(2)}</div>
      <div class="qty-controls">
        <button data-item="${item.id}" data-dir="-1">-</button>
        <span id="qty-${item.id}">0</span>
        <button data-item="${item.id}" data-dir="1">+</button>
      </div>
    </div>
  `).join("");

  app.innerHTML = `
    <div class="card">
      <h2>Order to your table</h2>
      ${rows}
      <button id="order-submit">Order</button>
      <div id="card-container"></div>
      <div id="order-error" class="error"></div>
    </div>
  `;

  bindHandlers();
}

function bindHandlers() {
  document.querySelectorAll(".qty-controls button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.item;
      const dir = Number(btn.dataset.dir);
      cart[id] = Math.max(0, (cart[id] || 0) + dir);
      document.getElementById(`qty-${id}`).textContent = cart[id];
    });
  });

  document.getElementById("order-submit").addEventListener("click", async () => {
    const items = config.menu.filter((m) => cart[m.id] > 0).map((m) => ({
      name: m.name, quantity: cart[m.id], pricePence: m.pricePence,
    }));
    const errorEl = document.getElementById("order-error");
    errorEl.style.color = "";
    if (items.length === 0) {
      errorEl.textContent = "Add something to your order first.";
      return;
    }

    const totalPence = items.reduce((sum, item) => sum + item.pricePence * item.quantity, 0);

    try {
      await collectCardAndSubmit(async (sourceId) => {
        const res = await fetch(`/api/tables/${tableId}/order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, sourceId }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Order failed");
        }
        for (const key in cart) cart[key] = 0;
        render();
        const freshErrorEl = document.getElementById("order-error");
        freshErrorEl.style.color = "var(--yellow)";
        freshErrorEl.textContent = "Order placed, on its way!";
      }, totalPence);
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}

// Renders a Square card element into #card-container and resolves with a
// sourceId once the customer submits, or rejects on failure. Same pattern
// as the seat page, every table order is a fresh charge since there's no
// session to keep a card on file against.
async function collectCardAndSubmit(onToken, amountPence) {
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
        const result = await card.tokenize({
          amount: (amountPence / 100).toFixed(2),
          currencyCode: "GBP",
          intent: "CHARGE",
          customerInitiated: true,
          sellerKeyedIn: false,
        });
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

init();
