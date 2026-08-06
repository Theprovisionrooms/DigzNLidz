const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let hours = null;
let tiers = null;
const tierCounts = { tier_1: 0, tier_2: 0, tier_3: 0 };

// Date picker shouldn't offer a date that's already gone, and the London
// calendar date is what matters here, not whatever date the browser or
// device thinks "today" is if either's clock is off or set to another
// timezone.
document.getElementById("bookingDate").min = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    hours = data.hours;
    tiers = data.tiers;

    const openDays = Object.keys(hours)
      .sort((a, b) => a - b)
      .map((day) => `${DAY_NAMES[day]} ${hours[day].open}\u2013${hours[day].close}`)
      .join(", ");
    const hint = document.createElement("p");
    hint.style.cssText = "color:var(--bone);opacity:0.7;font-size:13px;margin-top:-8px;";
    hint.textContent = `Open: ${openDays}. Closed Monday and Tuesday.`;
    document.querySelector(".wrap p").after(hint);

    renderTierPickers();
  } catch (e) {
    document.getElementById("tier-pickers").innerHTML =
      `<p class="error">Couldn't load pricing, refresh the page before booking.</p>`;
  }
}
loadConfig();

function renderTierPickers() {
  const container = document.getElementById("tier-pickers");
  container.innerHTML = Object.keys(tierCounts).map((key) => {
    const t = tiers[key];
    return `
      <div class="item-row">
        <div>${t.name} &middot; \u00a3${(t.pricePence / 100).toFixed(2)} each</div>
        <div class="qty-controls">
          <button type="button" data-tier="${key}" data-dir="-1">-</button>
          <span id="qty-${key}">0</span>
          <button type="button" data-tier="${key}" data-dir="1">+</button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.tier;
      const dir = Number(btn.dataset.dir);
      tierCounts[key] = Math.max(0, tierCounts[key] + dir);
      document.getElementById(`qty-${key}`).textContent = tierCounts[key];
      updateTotal();
    });
  });

  updateTotal();
}

function updateTotal() {
  const totalPence = Object.keys(tierCounts).reduce(
    (sum, key) => sum + tierCounts[key] * tiers[key].pricePence, 0
  );
  const partySize = Object.values(tierCounts).reduce((a, b) => a + b, 0);
  const totalEl = document.getElementById("total-line");
  totalEl.textContent = partySize > 0
    ? `${partySize} ${partySize === 1 ? "person" : "people"} \u00b7 total \u00a3${(totalPence / 100).toFixed(2)}`
    : "";
}

function checkWithinHours(bookingDate, slotTime) {
  if (!hours) return null; // config hasn't loaded yet, let the server catch it
  const day = new Date(`${bookingDate}T00:00:00`).getDay();
  const dayHours = hours[day];
  if (!dayHours) return "We're closed that day. Open Wednesday to Sunday.";
  if (slotTime < dayHours.open || slotTime >= dayHours.close) {
    return `That time's outside our hours for that day, ${dayHours.open} to ${dayHours.close}.`;
  }
  return null;
}

document.getElementById("booking-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("error");
  errorEl.textContent = "";

  if (Object.values(tierCounts).every((n) => n === 0)) {
    errorEl.textContent = "Pick at least one person and a session length.";
    return;
  }

  const payload = {
    type: document.getElementById("type").value,
    name: document.getElementById("name").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("phone").value,
    tierCounts,
    bookingDate: document.getElementById("bookingDate").value,
    slotTime: document.getElementById("slotTime").value,
    notes: document.getElementById("notes").value,
    discountCode: document.getElementById("discountCode").value || null,
  };

  const hoursError = checkWithinHours(payload.bookingDate, payload.slotTime);
  if (hoursError) {
    errorEl.textContent = hoursError;
    return;
  }

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Please wait...";

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");

    // Opt in to mailing list, non-blocking, and only if they actually
    // ticked the marketing consent box. Tagged with the booking type
    // (single/couple/family/group) so promos can be targeted by party
    // size later, e.g. a couples offer only going out to couples.
    if (document.getElementById("marketingConsent").checked) {
      fetch("/api/mailing-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: payload.email, source: "booking", tags: payload.type }),
      }).catch(() => {});
    }

    window.location.href = data.checkoutUrl;
  } catch (err) {
    errorEl.textContent = err.message;
    submitBtn.disabled = false;
    submitBtn.textContent = "Continue to payment";
  }
});
