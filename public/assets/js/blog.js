// Blog feed. Short updates, newest first, feed-style rather than
// separate article pages, closer to a Facebook page's post history
// than a traditional blog. Add a new update by adding an entry to
// posts.json, "date" (YYYY-MM-DD), "text", and an optional "image"
// path, no code change needed.

const app = document.getElementById("app");

function formatDate(d) {
  const date = new Date(d);
  const today = new Date();
  const diffDays = Math.round((today.setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

async function init() {
  let posts = [];
  try {
    const res = await fetch("/blog/posts.json");
    posts = await res.json();
  } catch (e) {
    console.error("couldn't load posts.json", e);
  }

  if (!posts || posts.length === 0) {
    app.innerHTML = `<div class="card"><p>Nothing posted yet, check back soon.</p></div>`;
    return;
  }

  app.innerHTML = posts
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((p) => `
      <div class="feed-post">
        <div class="feed-post-header">
          <img class="feed-post-avatar" src="/assets/img/branding/logo.webp" alt="">
          <div>
            <div class="feed-post-name">Digz N' Lidz</div>
            <div class="feed-post-date">${formatDate(p.date)}</div>
          </div>
        </div>
        <p class="feed-post-text">${p.text}</p>
        ${p.image ? `<img class="feed-post-image" src="${p.image}" alt="">` : ""}
      </div>
    `)
    .join("");
}

init();
