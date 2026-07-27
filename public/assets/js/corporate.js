document.getElementById("enquiry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("error");
  const successEl = document.getElementById("success");
  errorEl.textContent = "";
  successEl.textContent = "";

  const payload = {
    companyName: document.getElementById("companyName").value,
    contactName: document.getElementById("contactName").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("phone").value,
    eventDate: document.getElementById("eventDate").value,
    headcount: Number(document.getElementById("headcount").value) || null,
    eventDetails: document.getElementById("eventDetails").value,
  };

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";

  try {
    const res = await fetch("/api/corporate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");

    successEl.textContent = "Enquiry sent. We'll be in touch to confirm before any payment is taken.";
    e.target.reset();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Send enquiry";
  }
});
