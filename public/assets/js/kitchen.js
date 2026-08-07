// Kitchen order screen. Built for a dedicated tablet/TV sat in the
// kitchen or behind the counter, not for a quick glance on a phone.
// Priorities: an alert nobody can miss when an order lands, and a
// second, harder-to-ignore alert if it just sits there too long.

const POLL_MS = 4000;
const OVERDUE_WARN_SECONDS = 60;   // amber: getting on
const OVERDUE_ALERT_SECONDS = 120; // red + repeating alert: needs attention now
const REALERT_EVERY_MS = 25000;    // how often an overdue order re-sounds

let audioCtx = null;
let soundEnabled = false;
let knownOrderIds = new Set();
let lastOverdueAlertAt = new Map(); // orderId -> timestamp of last re-alert
let pollFailures = 0;
let pollTimer = null;

const soundGate = document.getElementById("sound-gate");
const loginView = document.getElementById("login-view");
const kitchenView = document.getElementById("kitchen-view");
const grid = document.getElementById("kv-grid");
const dot = document.getElementById("kv-dot");
const dotLabel = document.getElementById("kv-dot-label");
const clockEl = document.getElementById("kv-clock");

document.getElementById("sound-gate-btn").addEventListener("click", enableSoundAndStart);
document.getElementById("login-btn").addEventListener("click", login);
document.getElementById("password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
document.getElementById("test-alert-btn").addEventListener("click", () => playChime("new"));

setInterval(updateClock, 1000);
updateClock();

function updateClock() {
  clockEl.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ---- Audio ----
// Browsers won't let a page play sound until a real tap/click has
// happened on it, so the whole screen is gated behind one deliberate
// "enable" tap on load. After that, alerts fire on their own with no
// further interaction needed, that's the whole point of this screen.
function enableSoundAndStart() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  soundEnabled = true;
  soundGate.style.display = "none";

  // Try to keep the screen awake if the browser supports it. Not
  // critical, fails silently on anything that doesn't (e.g. older
  // Android webviews), the alert sound still works either way.
  if ("wakeLock" in navigator) {
    navigator.wakeLock.request("screen").catch(() => {});
  }

  checkAuthAndStart();
}

function playChime(kind) {
  if (!soundEnabled || !audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const now = audioCtx.currentTime;
  // "new order" = two bright ascending tones. "overdue" = three sharper,
  // faster tones, deliberately more urgent and a bit more annoying, it's
  // meant to nag until someone deals with it.
  const notes = kind === "overdue" ? [660, 660, 880] : [523, 784];
  const gap = kind === "overdue" ? 0.14 : 0.16;

  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * gap);
    gain.gain.exponentialRampToValueAtTime(0.35, now + i * gap + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * gap + gap * 0.9);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + i * gap);
    osc.stop(now + i * gap + gap);
  });
}

// ---- Auth ----
async function checkAuthAndStart() {
  const res = await fetch("/api/dashboard/summary");
  if (res.status === 401) {
    loginView.style.display = "block";
    return;
  }
  loginView.style.display = "none";
  kitchenView.style.display = "block";
  startPolling();
}

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
    const err = await res.json().catch(() => ({}));
    errorEl.textContent = err.error || "Wrong password, try again.";
    return;
  }

  loginView.style.display = "none";
  kitchenView.style.display = "block";
  startPolling();
}

// ---- Polling and rendering ----
function startPolling() {
  loadOrders();
  pollTimer = setInterval(loadOrders, POLL_MS);
}

async function loadOrders() {
  let data;
  try {
    const res = await fetch("/api/dashboard/orders");
    if (res.status === 401) {
      clearInterval(pollTimer);
      loginView.style.display = "block";
      kitchenView.style.display = "none";
      return;
    }
    if (!res.ok) throw new Error("bad response");
    data = await res.json();
    pollFailures = 0;
    setConnection(true);
  } catch (e) {
    pollFailures += 1;
    // One dropped poll isn't worth alarming staff over, wifi hiccups
    // happen. A few in a row is worth a clear visual so nobody assumes
    // "no orders shown" means "no orders", when it might mean "screen's
    // lost connection".
    if (pollFailures >= 3) setConnection(false);
    return;
  }

  render(data.orders);
}

function setConnection(isLive) {
  dot.classList.toggle("stale", !isLive);
  dotLabel.textContent = isLive ? "Live" : "Connection lost, retrying...";
}

function render(orders) {
  const nowIds = new Set(orders.map((o) => o.id));
  const newlyArrived = orders.filter((o) => !knownOrderIds.has(o.id));

  if (knownOrderIds.size > 0 && newlyArrived.length > 0) {
    playChime("new");
  }
  knownOrderIds = nowIds;

  if (orders.length === 0) {
    grid.innerHTML = `<div class="kv-empty">No active orders. All caught up.</div>`;
    return;
  }

  // Oldest first, so the thing that's been waiting longest is always at
  // the top left, where eyes land first on a grid.
  const sorted = [...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  grid.innerHTML = sorted.map((o) => cardHtml(o, newlyArrived.some((n) => n.id === o.id))).join("");

  sorted.forEach((o) => {
    document.getElementById(`prep-${o.id}`)?.addEventListener("click", () => updateStatus(o.id, "preparing"));
    document.getElementById(`done-${o.id}`)?.addEventListener("click", () => updateStatus(o.id, "delivered"));
  });

  checkOverdue(sorted);
}

function checkOverdue(orders) {
  const now = Date.now();
  for (const o of orders) {
    const ageSeconds = (now - new Date(o.created_at).getTime()) / 1000;
    if (ageSeconds < OVERDUE_ALERT_SECONDS) continue;

    const last = lastOverdueAlertAt.get(o.id) || 0;
    if (now - last >= REALERT_EVERY_MS) {
      playChime("overdue");
      lastOverdueAlertAt.set(o.id, now);
    }
  }
}

function cardHtml(order, isNew) {
  const ageSeconds = (Date.now() - new Date(order.created_at).getTime()) / 1000;
  const ageLabel = ageSeconds < 60 ? "Just now" : `${Math.floor(ageSeconds / 60)}m ago`;
  const ageClass = ageSeconds >= OVERDUE_ALERT_SECONDS ? "overdue" : ageSeconds >= OVERDUE_WARN_SECONDS ? "warn" : "";
  const cardStatusClass = ageSeconds >= OVERDUE_ALERT_SECONDS ? "status-overdue" : `status-${order.status}`;

  const where = order.seat_id ? `Seat ${order.seat_id}` : `Table ${order.table_id}`;
  const whereClass = order.seat_id ? "" : "table";

  const items = order.items
    .map((it) => `<li><span>${escapeHtml(it.name)}</span><span class="qty">x${it.quantity}</span></li>`)
    .join("");

  const actions =
    order.status === "placed"
      ? `<div class="kv-actions"><button id="prep-${order.id}">Start Preparing</button></div>`
      : `<div class="kv-actions"><button id="done-${order.id}" class="secondary">Mark Delivered</button></div>`;

  return `
    <div class="kv-card ${cardStatusClass} ${isNew ? "kv-new" : ""}">
      <div class="kv-card-top">
        <span class="kv-where ${whereClass}">${where}</span>
        <span class="kv-age ${ageClass}">${ageLabel}</span>
      </div>
      <span class="kv-status-label ${order.status}">${order.status}</span>
      <ul class="kv-items">${items}</ul>
      ${actions}
    </div>
  `;
}

async function updateStatus(id, status) {
  await fetch("/api/dashboard/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
  loadOrders();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
