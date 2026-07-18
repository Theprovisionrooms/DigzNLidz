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
}

function render(data) {
  const grid = document.getElementById("seat-grid");
  grid.innerHTML = data.seats.map((s) => `
    <div class="seat-tile seat-${s.status}" title="Seat ${s.id}: ${s.status}">${s.id}</div>
  `).join("");

  document.getElementById("rev-deposits").textContent = pence(data.revenue.depositsPence);
  document.getElementById("rev-food").textContent = pence(data.revenue.foodDrinkPence);
  document.getElementById("rev-extensions").textContent = pence(data.revenue.extensionsPence);

  document.getElementById("bookings-week").textContent = data.bookingsThisWeek;
  document.getElementById("bookings-today-breakdown").innerHTML = data.bookingsToday.length
    ? data.bookingsToday.map((b) => `<div class="stat-row"><span>${b.type} today</span><span>${b.n}</span></div>`).join("")
    : `<div class="stat-row"><span>No bookings today yet</span></div>`;

  document.getElementById("mailing-count").textContent = data.mailingListCount;

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
