// Renders the YouTube episode list on the podcast page from videos.json,
// newest first. Add a new episode by adding an entry to that file, no
// code change needed, same pattern as the blog feed.

const app = document.getElementById("app");

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

async function init() {
  let videos = [];
  try {
    const res = await fetch("/podcast/videos.json");
    videos = await res.json();
  } catch (e) {
    console.error("couldn't load videos.json", e);
  }

  if (!videos || videos.length === 0) {
    app.innerHTML = `<div class="card"><p>Nothing posted yet, check back soon.</p></div>`;
    return;
  }

  app.innerHTML = videos
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((v) => `
      <div class="card">
        <div class="video-embed">
          <iframe
            src="https://www.youtube.com/embed/${v.youtubeId}"
            title="${v.title}"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
        <h2>${v.title}</h2>
        <small style="color:#a89b87;">${formatDate(v.date)}</small>
      </div>
    `)
    .join("");
}

init();
