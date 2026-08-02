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
      id: m.id, quantity: cart[m.id],
    }));
    const errorEl = document.getElementById("order-error");
    errorEl.style.color = "";
    if (items.length === 0) {
      errorEl.textContent = "Add something to your order first.";
      return;
    }

    // Shown to the customer for the card form's amount only, the server
    // re-prices every item itself before charging anything.
    const totalPence = config.menu
      .filter((m) => cart[m.id] > 0)
      .reduce((sum, m) => sum + m.pricePence * cart[m.id], 0);

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

// Renders whichever of Apple Pay, Google Pay, and the card form the
// customer's device supports into #card-container, and resolves with a
// sourceId once one of them goes through. Same pattern as seat.js -
// every table order is a fresh charge since there's no session to keep a
// card on file against.
async function collectCardAndSubmit(onToken, amountPence) {
  const container = document.getElementById("card-container");
  container.innerHTML = "";

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

    const finish = async (sourceId, onFail) => {
      try {
        await onToken(sourceId);
        if (!settled) { settled = true; resolve(); }
      } catch (e) {
        onFail();
        if (!settled) { settled = true; reject(e); }
      }
    };

    // --- Apple Pay ---
    (async () => {
      try {
        const applePay = await squarePayments.applePay(paymentRequest);
        const btn = document.createElement("button");
        btn.textContent = " Pay";
        btn.className = "wallet-btn apple-pay-btn";
        walletsEl.appendChild(btn);
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const result = await applePay.tokenize();
            if (result.status !== "OK") throw new Error("Apple Pay didn't go through, try again.");
            await finish(result.token, () => { btn.disabled = false; });
          } catch (e) {
            btn.disabled = false;
            if (!settled) { settled = true; reject(e); }
          }
        });
      } catch (e) {
        // Not available on this device, nothing to show.
      }
    })();

    // --- Google Pay ---
    (async () => {
      try {
        const googlePay = await squarePayments.googlePay(paymentRequest);
        const mount = document.createElement("div");
        mount.className = "wallet-btn";
        walletsEl.appendChild(mount);
        await googlePay.attach(mount);
        mount.addEventListener("click", async (e) => {
          e.preventDefault();
          try {
            const result = await googlePay.tokenize();
            if (result.status !== "OK") throw new Error("Google Pay didn't go through, try again.");
            await finish(result.token, () => {});
          } catch (err) {
            if (!settled) { settled = true; reject(err); }
          }
        });
      } catch (e) {
        // Not available on this device, nothing to show.
      }
    })();

    // --- Card ---
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
          payBtn.disabled = false;
          payBtn.textContent = "Pay";
          if (!settled) { settled = true; reject(e); }
        }
      });
    })();
  });
}

init();
