const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let hours = null;
let tiers = null;
let bookingOpensDate = null;
// tier_1 (15 minutes, £5) is a walk-in-only option, no point pre-booking
// online for something that short, so it's deliberately left out of this
// form. Still fully available in person. See functions/api/bookings/index.js
// for the matching server-side block.
const tierCounts = { tier_2: 0, tier_3: 0 };
// Which model each person in the party wants, keyed by vehicle_models.slug
// (see migration 0018), plus whether they want a trailer with it. Populated
// from /api/vehicles once it loads. Actual per-guest picks live in
// personVehicles / personTrailers below.
let vehicleModels = null;
let trailersTotal = 0;
// Every slot on the picker starts on this grid, matches how sessions are
// actually scheduled at the seats.
const SLOT_GRANULARITY_MINUTES = 30;

const dateInput = document.getElementById("bookingDate");
const slotSelect = document.getElementById("slotTime");
const opensNotice = document.getElementById("opens-notice");

// Date picker shouldn't offer a date that's already gone, and the London
// calendar date is what matters here, not whatever date the browser or
// device thinks "today" is if either's clock is off or set to another
// timezone.
const todayLondon = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
dateInput.min = todayLondon;
// iOS Safari's native date-picker wheel doesn't reliably fire "change"
// until the field loses focus, on some devices that only happens once
// the user taps elsewhere, so the time-slot dropdown can be left stuck
// on "Pick a date first" even though a date's already been picked.
// "input" fires the moment the wheel value changes, so listening to
// both events covers desktop and mobile.
dateInput.addEventListener("change", populateTimeSlots);
dateInput.addEventListener("input", populateTimeSlots);

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    hours = data.hours;
    tiers = data.tiers;
    bookingOpensDate = data.bookingOpensDate || null;

    const openDays = Object.keys(hours)
      .sort((a, b) => a - b)
      .map((day) => `${DAY_NAMES[day]} ${hours[day].open}\u2013${hours[day].close}`)
      .join(", ");
    const hint = document.createElement("p");
    hint.style.cssText = "color:var(--bone);opacity:0.7;font-size:13px;margin-top:-8px;";
    hint.textContent = `Open: ${openDays}. Closed Monday and Tuesday.`;
    document.querySelector(".wrap p").after(hint);

    // Don't let the date picker offer a date before the shop's actually
    // taking bookings for, and tell people why so it's not a mystery.
    if (bookingOpensDate && bookingOpensDate > todayLondon) {
      dateInput.min = bookingOpensDate;
      const opensReadable = new Date(`${bookingOpensDate}T00:00:00`).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      });
      opensNotice.textContent = `We're opening for bookings from ${opensReadable}, that's the earliest date you can pick.`;
    }

    renderTierPickers();
    populateTimeSlots();
  } catch (e) {
    document.getElementById("tier-pickers").innerHTML =
      `<p class="error">Couldn't load pricing, refresh the page before booking.</p>`;
  }
}
loadConfig();

// Separate fetch from loadConfig on purpose: /api/vehicles is its own
// endpoint (see functions/api/vehicles/index.js) and one failing shouldn't
// take the other down with it. The "available" counts shown here are a
// live "right now" figure, a rough steer for whoever's filling the form
// in, not a guarantee for whatever future date they end up picking, the
// real check happens server-side against that specific slot when they
// submit (see /api/bookings).
async function loadVehicles() {
  try {
    const res = await fetch("/api/vehicles");
    const data = await res.json();
    vehicleModels = data.models;
    trailersTotal = data.trailersTotal;
    renderVehiclePickers();
  } catch (e) {
    document.getElementById("vehicle-pickers").innerHTML =
      `<p class="error">Couldn't load the vehicle list, refresh the page before booking.</p>`;
  }
}
loadVehicles();

function partySize() {
  return Object.values(tierCounts).reduce((a, b) => a + b, 0);
}

// One entry per guest in the party, index-matched: personVehicles[2] is
// guest 3's chosen model slug (or null, not picked yet), personTrailers[2]
// is whether they want a trailer with it. Resized whenever partySize()
// changes (see renderTierPickers' qty listener), keeping earlier picks
// where the index still exists.
let personVehicles = [];
let personTrailers = [];

function syncPersonArraysToPartySize() {
  const n = partySize();
  while (personVehicles.length < n) personVehicles.push(null);
  while (personTrailers.length < n) personTrailers.push(false);
  personVehicles.length = n;
  personTrailers.length = n;
}

function vehicleAssignedCount() {
  return personVehicles.filter(Boolean).length;
}

function vehicleBreakdownFromSelections() {
  const breakdown = {};
  for (const slug of personVehicles) {
    if (!slug) continue;
    breakdown[slug] = (breakdown[slug] || 0) + 1;
  }
  return breakdown;
}

function trailerCountFromSelections() {
  return personTrailers.filter(Boolean).length;
}

// How many units of a model are still free to pick, physically: total
// units minus how many other guests in this same form have already taken
// one. This is a party-internal cap, not a live stock check, someone
// else's booking or a walk-in could still take the actual last unit
// between now and when this form's submitted, that's re-checked
// server-side (see /api/bookings).
function remainingForModel(slug, excludingPersonIndex) {
  const model = vehicleModels.find((m) => m.slug === slug);
  if (!model) return 0;
  const takenByOthers = personVehicles.filter((s, i) => s === slug && i !== excludingPersonIndex).length;
  return model.total_units - takenByOthers;
}

function remainingTrailers(excludingPersonIndex) {
  const takenByOthers = personTrailers.filter((t, i) => t && i !== excludingPersonIndex).length;
  return trailersTotal - takenByOthers;
}

function renderVehiclePickers() {
  const container = document.getElementById("vehicle-pickers");
  if (!vehicleModels) return;
  syncPersonArraysToPartySize();

  if (personVehicles.length === 0) {
    container.innerHTML = `<p style="font-size:12px;color:var(--bone);opacity:0.7;">Pick how many people first.</p>`;
    updateVehicleTotal();
    return;
  }

  container.innerHTML = personVehicles.map((selectedSlug, i) => `
    <div class="person-vehicle-block">
      <span class="field-label">Guest ${i + 1}'s vehicle</span>
      <div class="vehicle-grid" data-person="${i}">
        ${vehicleModels.map((m) => {
          const remaining = remainingForModel(m.slug, i);
          const isSelected = selectedSlug === m.slug;
          const disabled = remaining <= 0 && !isSelected;
          return `
            <button type="button" class="vehicle-option${isSelected ? " selected" : ""}${disabled ? " disabled" : ""}"
              data-person="${i}" data-slug="${m.slug}" ${disabled ? "disabled" : ""}>
              <img src="${m.image_path}" alt="${m.name}" loading="lazy">
              <strong>${m.name}</strong>
              ${m.description ? `<small>${m.description}</small>` : ""}
              <span class="vehicle-availability">${remaining > 0 ? `${remaining} left for the party` : "None left for the party"}</span>
            </button>
          `;
        }).join("")}
      </div>
      ${selectedSlug && vehicleModels.find((m) => m.slug === selectedSlug)?.has_trailer_option ? `
        <label class="trailer-check">
          <input type="checkbox" data-person="${i}" class="trailer-check-input" ${personTrailers[i] ? "checked" : ""}
            ${!personTrailers[i] && remainingTrailers(i) <= 0 ? "disabled" : ""}>
          <img src="/assets/img/vehicles/trailer.png" alt="Trailer">
          Add a trailer (${remainingTrailers(i)} of ${trailersTotal} left for the party)
        </label>
      ` : ""}
    </div>
  `).join("");

  container.querySelectorAll(".vehicle-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.person);
      const slug = btn.dataset.slug;
      personVehicles[i] = personVehicles[i] === slug ? null : slug;
      if (personVehicles[i] !== slug) personTrailers[i] = false; // deselected or switched model, drop any trailer pick
      renderVehiclePickers();
    });
  });

  container.querySelectorAll(".trailer-check-input").forEach((box) => {
    box.addEventListener("change", () => {
      const i = Number(box.dataset.person);
      personTrailers[i] = box.checked;
      renderVehiclePickers();
    });
  });

  updateVehicleTotal();
}

function updateVehicleTotal() {
  const el = document.getElementById("vehicle-total-line");
  const assigned = vehicleAssignedCount();
  const needed = partySize();
  el.textContent = needed > 0 ? `${assigned} of ${needed} people have a vehicle picked` : "";
  el.style.color = assigned === needed ? "" : "var(--yellow)";
}

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
      // Session length picked affects how late a slot can start and still
      // finish before close, so the time options need to shift with it.
      populateTimeSlots();
      // Party size just changed, so the per-guest vehicle pickers need to
      // grow/shrink (and re-render, since remaining-stock counts shift too).
      renderVehiclePickers();
    });
  });

  updateTotal();
}

// Longest session length currently picked, in minutes. Drives how late a
// time slot can start and still finish before closing. Defaults to the
// shortest bookable tier (30 min) before anyone's picked a length yet, so
// the picker isn't empty while people are still filling the form in.
function selectedDurationMinutes() {
  const picked = Object.keys(tierCounts)
    .filter((key) => tierCounts[key] > 0)
    .map((key) => tiers[key].minutes);
  if (picked.length === 0) {
    return tiers?.tier_2?.minutes || 30;
  }
  return Math.max(...picked);
}

// Builds the list of bookable start times for whatever date's picked,
// on the 30-minute grid, stopping early enough that the longest session
// currently selected still finishes before closing time. Keeps someone
// from ever landing on a time that's outside opening hours, on a closed
// day, or that would run past close, so the only options ever shown are
// ones that actually work.
function slotsForDate(dateStr) {
  if (!hours || !dateStr) return [];
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  const dayHours = hours[day];
  if (!dayHours) return [];

  const [openH, openM] = dayHours.open.split(":").map(Number);
  const [closeH, closeM] = dayHours.close.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  const duration = selectedDurationMinutes();

  const nowTimeLondon = dateStr === todayLondon
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())
    : null;

  const slots = [];
  for (let t = openMinutes; t + duration <= closeMinutes; t += SLOT_GRANULARITY_MINUTES) {
    const label = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    if (nowTimeLondon && label <= nowTimeLondon) continue; // today, already passed
    slots.push(label);
  }
  return slots;
}

function populateTimeSlots() {
  const dateStr = dateInput.value;

  if (!dateStr) {
    slotSelect.innerHTML = `<option value="">Pick a date first</option>`;
    slotSelect.disabled = true;
    return;
  }

  if (bookingOpensDate && dateStr < bookingOpensDate) {
    slotSelect.innerHTML = `<option value="">Not open for bookings yet</option>`;
    slotSelect.disabled = true;
    return;
  }

  // Config (opening hours) hasn't come back from /api/config yet, usually
  // just a slower mobile connection. loadConfig() re-runs this function
  // itself once it lands, so this is a holding state, not a dead end.
  if (!hours) {
    slotSelect.innerHTML = `<option value="">Loading times...</option>`;
    slotSelect.disabled = true;
    return;
  }

  const slots = slotsForDate(dateStr);
  if (slots.length === 0) {
    const day = new Date(`${dateStr}T00:00:00`).getDay();
    const closed = hours && !hours[day];
    slotSelect.innerHTML = `<option value="">${closed ? "Closed that day, pick Wed\u2013Sun" : "No slots left that day"}</option>`;
    slotSelect.disabled = true;
    return;
  }

  slotSelect.innerHTML = `<option value="">Select a time</option>` +
    slots.map((s) => `<option value="${s}">${s}</option>`).join("");
  slotSelect.disabled = false;
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

  if (!document.getElementById("bookingDate").value || !document.getElementById("slotTime").value) {
    errorEl.textContent = "Pick a date and a time slot.";
    return;
  }

  if (vehicleAssignedCount() !== partySize()) {
    errorEl.textContent = "Pick a vehicle for everyone in the party before continuing.";
    return;
  }

  if (bookingOpensDate && document.getElementById("bookingDate").value < bookingOpensDate) {
    errorEl.textContent = `We're not taking bookings for that date yet, online booking opens from ${bookingOpensDate}.`;
    return;
  }

  const payload = {
    type: document.getElementById("type").value,
    name: document.getElementById("name").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("phone").value,
    tierCounts,
    vehicleBreakdown: vehicleBreakdownFromSelections(),
    trailerCount: trailerCountFromSelections(),
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
