// Shared walk-in QR page. One code on the wall or counter instead of
// needing to find and scan a specific free seat's own code. Grabs the
// next available seat from the server and sends the guest straight into
// that seat's normal start screen, same tier picker and payment flow as
// scanning it directly.

const app = document.getElementById("app");

async function findSeat() {
  try {
    const res = await fetch("/api/seats/next-free");
    const data = await res.json();

    if (!res.ok) {
      app.innerHTML = `
        <p>${data.error || "No free seats right now."}</p>
        <button onclick="findSeat()">Try again</button>
      `;
      return;
    }

    window.location.href = `/seat/?seat=${data.seat}`;
  } catch (e) {
    app.innerHTML = `
      <p>Couldn't reach the system, check you're connected and try again.</p>
      <button onclick="findSeat()">Try again</button>
    `;
  }
}

findSeat();
