// Shared walk-in QR page. One code on the wall or counter instead of
// needing to find and scan a specific free seat's own code.
//
// Asks how many are in the party first. Solo walk-ins go straight into
// the existing single-seat flow (grabs one free seat, same tier picker
// and payment as scanning it directly). Groups of 2+ go to /group-start/
// instead, which claims several seats at once and takes one payment for
// the whole group rather than everyone paying separately.

const app = document.getElementById("app");

function renderHeadcountPrompt() {
  app.innerHTML = `
    <div class="card">
      <h2>How many in your group?</h2>
      <p><small>One payment covers everyone, no need for each person to pay separately.</small></p>
      <input type="number" id="party-size" value="1" min="1" max="16" style="width:100%;padding:10px;margin:10px 0;font-size:18px;text-align:center;">
      <button id="party-continue">Find us a seat</button>
    </div>
  `;
  document.getElementById("party-continue").addEventListener("click", () => {
    const size = Math.max(1, Math.min(16, Number(document.getElementById("party-size").value) || 1));
    if (size === 1) {
      findSingleSeat();
    } else {
      window.location.href = `/group-start/?size=${size}`;
    }
  });
}

async function findSingleSeat() {
  app.innerHTML = `<p>Finding you a free seat...</p>`;
  try {
    const res = await fetch("/api/seats/next-free");
    const data = await res.json();

    if (!res.ok) {
      app.innerHTML = `
        <p>${data.error || "No free seats right now."}</p>
        <button onclick="location.reload()">Try again</button>
      `;
      return;
    }

    window.location.href = `/seat/?seat=${data.seat}`;
  } catch (e) {
    app.innerHTML = `
      <p>Couldn't reach the system, check you're connected and try again.</p>
      <button onclick="location.reload()">Try again</button>
    `;
  }
}

renderHeadcountPrompt();
