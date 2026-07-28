const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");

document.getElementById("login-btn").addEventListener("click", login);
document.getElementById("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});

async function login() {
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    errorEl.textContent = "Incorrect password.";
    return;
  }

  loginView.style.display = "none";
  dashboardView.style.display = "block";
  loadDashboard();
  setInterval(loadDashboard, 10000);
}

function pence(p) {
  return `£${(p / 100).toFixed(2)}`;
}

async function loadDashboard() {
  const res = await fetch("/api/dashboard/summary");
  if (res.status === 401) {
    loginView.style.display = "block";
    dashboardView.style.display = "none";
    return;
  }
  const data = await res.json();
  render(data);
  loadDiscountCodes();
  loadOrders();
}

async function loadOrders() {
  const res = await fetch("/api/dashboard/orders");
  if (!res.ok) return;
  const data = await res.json();
  const list = document.getElementById("orders-list");

  if (data.orders.length === 0) {
    list.innerHTML = `<p><small>No active orders.</small></p>`;
    return;
  }

  list.innerHTML = data.orders.map((o) => `
    <div class="card" style="background:#141414;">
      <strong>${o.table_id ? `Table ${o.table_id}` : `Seat ${o.seat_id}`}</strong> · ${pence(o.total_pence)} · <small>${o.status}</small>
      <p style="font-size:13px;">${o.items.map((i) => `${i.quantity || 1}x ${i.name}`).join(", ")}</p>
      ${o.status === "placed" ? `<button onclick="updateOrder(${o.id}, 'preparing')">Mark preparing</button>` : ""}
      ${o.status === "preparing" ? `<button onclick="updateOrder(${o.id}, 'delivered')">Mark delivered</button>` : ""}
    </div>
  `).join("");
}

async function updateOrder(id, status) {
  const res = await fetch("/api/dashboard/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || "Something went wrong");
    return;
  }
  loadOrders();
}

async function loadDiscountCodes() {
  const res = await fetch("/api/dashboard/discount-codes");
  if (!res.ok) return;
  const data = await res.json();
  const list = document.getElementById("discount-list");
  if (data.codes.length === 0) {
    list.innerHTML = `<p><small>No codes yet.</small></p>`;
    return;
  }
  list.innerHTML = `
    <table>
      <tr><th>Code</th><th>Value</th><th>Campaign</th><th>Uses</th></tr>
      ${data.codes.map((c) => `
        <tr>
          <td>${c.code}</td>
          <td>${c.discount_type === "percent" ? c.discount_value + "%" : pence(c.discount_value)}</td>
          <td>${c.campaign_name || "-"}</td>
          <td>${c.uses}${c.usage_limit ? " / " + c.usage_limit : ""}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

async function createDiscountCode() {
  const code = document.getElementById("dc-code").value.trim();
  const discountType = document.getElementById("dc-type").value;
  const discountValue = Number(document.getElementById("dc-value").value);
  const campaignName = document.getElementById("dc-campaign").value.trim() || null;
  const usageLimit = Number(document.getElementById("dc-limit").value) || null;

  if (!code || !discountValue) {
    alert("Enter a code and a value first.");
    return;
  }

  const res = await fetch("/api/dashboard/discount-codes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, discountType, discountValue, campaignName, usageLimit }),
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error || "Something went wrong");
    return;
  }

  document.getElementById("dc-code").value = "";
  document.getElementById("dc-value").value = "";
  document.getElementById("dc-campaign").value = "";
  document.getElementById("dc-limit").value = "";
  loadDiscountCodes();
}

async function sendCampaign() {
  const tag = document.getElementById("camp-tag").value;
  const subject = document.getElementById("camp-subject").value.trim();
  const html = document.getElementById("camp-body").value.trim();
  const limit = Number(document.getElementById("camp-limit").value) || null;
  const statusEl = document.getElementById("camp-status");

  if (!subject || !html) {
    alert("Enter a subject and body first.");
    return;
  }

  statusEl.textContent = "Sending...";
  statusEl.style.color = "var(--bone)";

  const res = await fetch("/api/dashboard/campaigns/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag, subject, html, limit }),
  });
  const data = await res.json();

  if (!res.ok) {
    statusEl.textContent = data.error || "Something went wrong";
    statusEl.style.color = "var(--rust)";
    return;
  }

  statusEl.textContent = data.message;
  statusEl.style.color = "var(--yellow)";
  document.getElementById("camp-subject").value = "";
  document.getElementById("camp-body").value = "";
  document.getElementById("camp-limit").value = "";
  loadDashboard();
}

// Staff-facing nudge: no automatic seat blocking exists (soft block, by
// design, see BUILD_CHECKLIST), so this has to do the job of making sure
// nobody misses that a family or group needs seats held for them.
const TIER_LABELS = { tier_1: "15min", tier_2: "30min", tier_3: "60min" };

// Matches NO_SHOW_GRACE_MINUTES in workers/session-expiry-cron.js: how
// long past the slot a held seat waits before it's released back to
// free. Once a booking's past this, its seat may well have gone to a
// walk-in in the meantime, that's fine, they've already paid, staff
// just need to sit them wherever's next free rather than the seat
// that happened to hold their tier originally.
const NO_SHOW_GRACE_MINUTES = 10;

function remainingSeats(breakdown, redeemed) {
  return Object.keys(TIER_LABELS).reduce((sum, tier) => {
    const paidFor = Number(breakdown[tier]) || 0;
    const done = Number(redeemed[tier]) || 0;
    return sum + Math.max(0, paidFor - done);
  }, 0);
}

function renderHoldPanel(bookings) {
  const list = document.getElementById("hold-list");
  const summaryEl = document.getElementById("bookings-today-summary");
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const totalGuests = bookings.reduce((sum, b) => sum + (Number(b.party_size) || 0), 0);
  summaryEl.textContent = bookings.length
    ? `${bookings.length} booking${bookings.length === 1 ? "" : "s"} today \u00b7 ${totalGuests} guest${totalGuests === 1 ? "" : "s"} total`
    : "No bookings today";

  const upcoming = bookings
    .map((b) => {
      const [h, m] = b.slot_time.split(":").map(Number);
      const breakdown = JSON.parse(b.tier_breakdown_json || "{}");
      const redeemed = JSON.parse(b.tier_redeemed_json || "{}");
      return { ...b, slotMinutes: h * 60 + m, breakdown, redeemed };
    })
    .filter((b) => {
      // Anything not more than 30 minutes past its slot stays visible in
      // case they're running a little late. Past that, a paid booking
      // with seats still unredeemed never drops off the list, however
      // late, since they've paid and staff still need to seat them the
      // moment something's free, dropping them here would just mean
      // someone has to remember to go looking manually instead.
      if (b.slotMinutes >= nowMinutes - 30) return true;
      return b.payment_status === "paid" && remainingSeats(b.breakdown, b.redeemed) > 0;
    })
    .sort((a, b) => a.slotMinutes - b.slotMinutes);

  if (upcoming.length === 0) {
    list.innerHTML = `<p style="font-size:13px;opacity:0.7;margin:0;">Nothing left today.</p>`;
    return;
  }

  list.innerHTML = upcoming.map((b) => {
    const urgent = b.slotMinutes - nowMinutes <= 60;
    const notPaid = b.payment_status !== "paid";
    // Past the no-show grace period with seats still unredeemed, their
    // hold's likely gone to a walk-in by now. Not a problem, just means
    // staff are sitting them fresh rather than on the original seat.
    const late = !notPaid && nowMinutes > b.slotMinutes + NO_SHOW_GRACE_MINUTES && remainingSeats(b.breakdown, b.redeemed) > 0;

    const tierButtons = Object.keys(TIER_LABELS).map((tier) => {
      const paidFor = Number(b.breakdown[tier]) || 0;
      const done = Number(b.redeemed[tier]) || 0;
      if (paidFor === 0) return "";
      const remaining = paidFor - done;
      return `<button
        ${remaining <= 0 || notPaid ? "disabled" : ""}
        onclick="redeemSeat(${b.id}, '${tier}')"
        style="margin:2px 4px 0 0;font-size:12px;padding:4px 8px;"
      >${TIER_LABELS[tier]}: ${done}/${paidFor}</button>`;
    }).join("");

    return `
      <div class="hold-row ${urgent ? "urgent" : ""} ${late ? "late" : ""}" style="flex-direction:column;align-items:flex-start;gap:4px;">
        <div style="display:flex;justify-content:space-between;width:100%;">
          <span>${b.slot_time} &middot; ${b.name} (${b.type})${late ? ' <span class="late-tag">Late, seat any free spot</span>' : ""}</span>
          <span class="seats-needed">${b.party_size || "?"} seats ${notPaid ? "&middot; unpaid" : ""}</span>
        </div>
        <div>${tierButtons}</div>
      </div>
    `;
  }).join("");
}

async function redeemSeat(bookingId, tier) {
  const seatId = prompt(`Which seat number for this ${TIER_LABELS[tier]} slot?`);
  if (!seatId) return;
  const res = await fetch(`/api/bookings/${bookingId}/redeem-seat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seatId: Number(seatId), tier }),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || "Something went wrong");
    return;
  }
  loadDashboard();
}

// Physical layout of the RC pit: |__| — 5 seats down the left leg, 6
// across the front, 5 up the right leg, open at the top. This ordering
// (left top-to-bottom, front left-to-right, right top-to-bottom) is a
// first-cut placeholder, reorder the numbers below to match the real
// seat numbers painted on the pit.
const PIT_LAYOUT = {
  left:  [1, 2, 3, 4, 5],
  front: [6, 7, 8, 9, 10, 11],
  right: [12, 13, 14, 15, 16],
};

function seatStatusClass(status) {
  if (status === "free") return "status-free";
  if (status === "held") return "status-held"; // booked soon, auto-pinned to a booking
  return "status-taken"; // active or awaiting_extension
}

function renderPit(seats) {
  const byId = Object.fromEntries(seats.map((s) => [s.id, s]));
  const tiles = [];

  PIT_LAYOUT.left.forEach((seatId, i) => {
    const s = byId[seatId];
    if (!s) return;
    tiles.push(`<div class="pit-seat ${seatStatusClass(s.status)}" style="grid-column:1; grid-row:${i + 1};" title="Seat ${seatId}: ${s.status}">${seatId}</div>`);
  });
  PIT_LAYOUT.front.forEach((seatId, i) => {
    const s = byId[seatId];
    if (!s) return;
    tiles.push(`<div class="pit-seat ${seatStatusClass(s.status)}" style="grid-column:${i + 2}; grid-row:6;" title="Seat ${seatId}: ${s.status}">${seatId}</div>`);
  });
  PIT_LAYOUT.right.forEach((seatId, i) => {
    const s = byId[seatId];
    if (!s) return;
    tiles.push(`<div class="pit-seat ${seatStatusClass(s.status)}" style="grid-column:8; grid-row:${i + 1};" title="Seat ${seatId}: ${s.status}">${seatId}</div>`);
  });

  document.getElementById("pit-grid").innerHTML = tiles.join("");
}

function render(data) {
  renderPit(data.seats);

  document.getElementById("rev-bookings").textContent = pence(data.revenue.bookingsPence);
  document.getElementById("rev-food").textContent = pence(data.revenue.foodDrinkPence);
  document.getElementById("rev-extensions").textContent = pence(data.revenue.extensionsPence);

  document.getElementById("bookings-week").textContent = data.bookingsThisWeek;
  document.getElementById("bookings-today-breakdown").innerHTML = data.bookingsToday.length
    ? data.bookingsToday.map((b) => `<div class="stat-row"><span>${b.type} today</span><span>${b.n}</span></div>`).join("")
    : `<div class="stat-row"><span>No bookings today yet</span></div>`;

  renderHoldPanel(data.bookingsTodayDetail);

  document.getElementById("mailing-count").textContent = data.mailingListCount;
  document.getElementById("mailing-trend").innerHTML = data.mailingListTrend.length
    ? `<table><tr><th>Week</th><th>New signups</th></tr>${data.mailingListTrend.map((w) => `
        <tr><td>${w.week}</td><td>${w.n}</td></tr>
      `).join("")}</table>`
    : `<p><small>No signups yet.</small></p>`;

  const segmentsEl = document.getElementById("mailing-segments");
  segmentsEl.innerHTML = data.mailingListSegments.length
    ? `<table><tr><th>Type</th><th>Subscribers</th></tr>${data.mailingListSegments.map((s) => `
        <tr><td style="text-transform:capitalize;">${s.tag}</td><td>${s.n}</td></tr>
      `).join("")}</table>`
    : `<small>No tagged signups yet.</small>`;

  const campaignList = document.getElementById("campaign-list");
  campaignList.innerHTML = data.campaignPerformance.length
    ? `<table>
        <tr><th>Campaign</th><th>Type</th><th>Codes</th><th>Redemptions</th></tr>
        ${data.campaignPerformance.map((c) => `
          <tr>
            <td>${c.name}</td>
            <td>${c.type || "-"}</td>
            <td>${c.codeCount}</td>
            <td>${c.redemptions}</td>
          </tr>
        `).join("")}
      </table>`
    : `<p><small>No campaigns yet.</small></p>`;

  const corpList = document.getElementById("corporate-list");
  if (data.pendingCorporateEnquiries.length === 0) {
    corpList.innerHTML = `<p><small>Nothing pending.</small></p>`;
  } else {
    corpList.innerHTML = data.pendingCorporateEnquiries.map((e) => `
      <div class="card" style="background:#141414;">
        <strong>${e.company_name || e.contact_name}</strong><br>
        <small>${e.contact_name} · ${e.email} · ${e.headcount || "?"} people · ${e.event_date || "date TBC"}</small>
        <p style="font-size:13px;">${e.event_details || ""}</p>
        <input type="number" placeholder="Deposit amount in pence" id="deposit-${e.id}" style="width:100%;padding:8px;margin:6px 0;">
        <button onclick="confirmEnquiry(${e.id})">Confirm & send payment link</button>
      </div>
    `).join("");
  }
}

async function confirmEnquiry(id) {
  const depositPence = Number(document.getElementById(`deposit-${id}`).value);
  if (!depositPence) {
    alert("Enter a deposit amount in pence first, e.g. 5000 for £50.");
    return;
  }
  const res = await fetch(`/api/corporate/${id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depositPence }),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || "Something went wrong");
    return;
  }
  loadDashboard();
}
