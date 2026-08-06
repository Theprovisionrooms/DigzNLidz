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
    const data = await res.json();
    renderConfirmation(data.groupCode);
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
      const data = await res.json();
      renderConfirmation(data.groupCode);
    }, totalPence);
  } catch (e) {
    errorEl.textContent = e.message;
  }
}

function renderConfirmation(groupCode) {
  // The device that just paid already has the code, no reason to make
  // this one person type it back in, unlike everyone else at the table
  // who'll be prompted once on their own phone (see seat.js).
  localStorage.setItem("dnl_group_code", groupCode);
  for (const id of claimedSeats) localStorage.setItem(`dnl_token_${id}`, groupCode);

  app.innerHTML = `
    <div class="card">
      <h2>You're all set</h2>
      <p>Your seats: <strong>${claimedSeats.join(", ")}</strong></p>
      <p>Your table code: <strong style="font-size:1.4em;letter-spacing:2px;">${groupCode}</strong></p>
      <p><small>Spread out and settle in. The first time anyone in your group orders or extends from a seat, their phone will ask for this code, once, then it's remembered on that phone for the rest of the visit, and works at any of your seats. Share it with your table.</small></p>
    </div>
  `;
}

// Renders whichever of Apple Pay, Google Pay, and the card form the
// customer's device supports into #card-container, and resolves with a
// sourceId once one of them goes through. Same pattern as seat.js.
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
