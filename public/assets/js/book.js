const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let hours = null;

async function loadHours() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    hours = data.hours;
    const openDays = Object.keys(hours)
      .sort((a, b) => a - b)
      .map((day) => `${DAY_NAMES[day]} ${hours[day].open}\u2013${hours[day].close}`)
      .join(", ");
    const hint = document.createElement("p");
    hint.style.cssText = "color:var(--bone);opacity:0.7;font-size:13px;margin-top:-8px;";
    hint.textContent = `Open: ${openDays}. Closed Monday and Tuesday.`;
    document.querySelector(".wrap p").after(hint);
  } catch (e) {
    // Non-fatal, the server still enforces this even if the hint fails to load.
  }
}
loadHours();

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

  const payload = {
    type: document.getElementById("type").value,
    name: document.getElementById("name").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("phone").value,
    partySize: Number(document.getElementById("partySize").value) || null,
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

    // Opt in to mailing list, non-blocking
    fetch("/api/mailing-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: payload.email, source: "booking" }),
    }).catch(() => {});

    window.location.href = data.checkoutUrl;
  } catch (err) {
    errorEl.textContent = err.message;
    submitBtn.disabled = false;
    submitBtn.textContent = "Continue to deposit";
  }
});
