// Group walk-in flow. Reached from /start/ once the guest has said how
// many are in their party (2+, solo walk-ins skip straight to /seat/).
// Claims that many seats at once, shows one tier picker, takes one
// payment for the whole group. Same tier for everyone, keeping it to a
// single charge, mixed tiers still have to scan individually.

const size = Math.max(1, Math.min(16, Number(new URLSearchParams(location.search).get("size")) || 1));
const app = document.getElementById("app");

let config = null;
let squarePayments = null;
let claimedSeats = null;

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
  const configRes = await fetch("/api/config");
  config = await configRes.json();
  await loadSquareSdk(config.squareEnv);
  squarePayments = window.Square.payments(config.squareApplicationId, config.squareLocationId);

  await claimSeats();
}

async function claimSeats() {
  app.innerHTML = `<p>Finding ${size} seats together...</p>`;

  try {
    const res = await fetch(`/api/seats/next-free-group?size=${size}`);
    const data = await res.json();

    if (!res.ok) {
      renderNotEnoughSeats(data);
      return;
    }

    claimedSeats = data.seats;
    renderTierPicker();
  } catch (e) {
    app.innerHTML = `
      <div class="card error">Couldn't reach the system, check you're connected and try again.</div>
      <button onclick="claimSeats()">Try again</button>
    `;
  }
}

function renderNotEnoughSeats(data) {
  app.innerHTML = `
    <div class="card">
      <h2>Not quite enough seats yet</h2>
      <p>${data.error}</p>
      <button id="retry-claim">Try again</button>
      <button id="split-up" class="secondary">Split into smaller groups instead</button>
    </div>
  `;
  document.getElementById("retry-claim").addEventListener("click", claimSeats);
  document.getElementById("split-up").addEventListener("click", () => {
    window.location.href = "/start/";
  });
}

function renderTierPicker() {
  const rows = Object.entries(config.tiers).map(([key, tier]) => {
    const totalPence = tier.pricePence * claimedSeats.length;
    return `
      <div class="tier-option">
        <div>
          <strong>${tier.name}</strong><br>
          <small>${tier.minutes} minutes · ${claimedSeats.length} people${totalPence > 0 ? ` · £${(totalPence / 100).toFixed(2)} total` : ""}</small>
        </div>
        <button data-tier="${key}" class="start-tier-btn" style="width:auto;">Start</button>
      </div>
    `;
  }).join("");

  app.innerHTML = `
    <div class="card">
      <h2>Choose your session</h2>
      <p><small>Seats ${claimedSeats.join(", ")} held for your group. One payment covers everyone.</small></p>
      ${rows}
    </div>
    <div id="card-container"></div>
    <div id="tier-error" class="error"></div>
  `;

  document.querySelectorAll(".start-tier-btn").forEach((btn) => {
    btn.addEventListener("click", () => startGroup(btn.dataset.tier));
  });
}

async function startGroup(tierKey) {
  const tier = config.tiers[tierKey];
  const totalPence = tier.pricePence * claimedSeats.length;
  const errorEl = document.getElementById("tier-error");
  errorEl.textContent = "";

  if (totalPence === 0) {
    const res = await fetch("/api/seats/group/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatIds: claimedSeats, tier: tierKey }),
    });
    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || "Something went wrong, ask a member of staff to help.";
      return;
    }
    renderConfirmation();
    return;
  }

  try {
    await collectCardAndSubmit(async (sourceId) => {
      const res = await fetch("/api/seats/group/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatIds: claimedSeats, tier: tierKey, sourceId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Payment failed");
      }
      renderConfirmation();
    }, totalPence);
  } catch (e) {
    errorEl.textContent = e.message;
  }
}

function renderConfirmation() {
  app.innerHTML = `
    <div class="card">
      <h2>You're all set</h2>
      <p>Your seats: <strong>${claimedSeats.join(", ")}</strong></p>
      <p><small>Spread out and settle in, everyone's card is already on file so food and drink orders from any of your seats won't ask for payment again.</small></p>
    </div>
  `;
}

// Same pattern as seat.js: mounts a Square card element, resolves with a
// sourceId once the customer submits.
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
