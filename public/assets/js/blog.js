const app = document.getElementById("app");
const pageTitle = document.getElementById("page-title");

async function init() {
  const res = await fetch("/blog/posts.json");
  const posts = await res.json();
  const slug = new URLSearchParams(location.search).get("post");

  if (slug) {
    renderPost(posts.find((p) => p.slug === slug));
  } else {
    renderList(posts);
  }
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function renderList(posts) {
  pageTitle.textContent = "Blog";
  if (posts.length === 0) {
    app.innerHTML = `<div class="card"><p>Nothing posted yet, check back soon.</p></div>`;
    return;
  }
  app.innerHTML = posts
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((p) => `
      <a href="/blog/?post=${p.slug}" style="text-decoration:none;">
        <div class="card">
          <h2>${p.title}</h2>
          <small style="color:#a89b87;">${formatDate(p.date)}</small>
          <p>${p.excerpt}</p>
        </div>
      </a>
    `).join("");
}

function renderPost(post) {
  if (!post) {
    app.innerHTML = `<div class="card"><p>Post not found.</p><a href="/blog/" style="color:var(--yellow);">Back to blog</a></div>`;
    return;
  }
  pageTitle.textContent = post.title;
  app.innerHTML = `
    <div class="card">
      <small style="color:#a89b87;">${formatDate(post.date)}</small>
      <div style="margin-top:10px;">${post.content}</div>
    </div>
    <a href="/blog/" style="color:var(--yellow);">Back to blog</a>
  `;
}

init();
