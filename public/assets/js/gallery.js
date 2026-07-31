const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let photos = [];
let currentIndex = 0;

async function loadGallery() {
  const grid = document.getElementById("gallery-grid");
  const emptyMsg = document.getElementById("gallery-empty");

  try {
    const res = await fetch("/assets/gallery/manifest.json");
    const data = await res.json();
    photos = data.photos || [];
  } catch (e) {
    photos = [];
  }

  if (photos.length === 0) {
    emptyMsg.hidden = false;
    return;
  }

  grid.innerHTML = photos.map((p, i) => `
    <button class="gallery-item" data-index="${i}" aria-label="View photo: ${escapeHtml(p.caption || "")}">
      <img src="/assets/gallery/photos/${encodeURIComponent(p.file)}" alt="${escapeHtml(p.caption || "")}" loading="lazy">
    </button>
  `).join("");

  grid.querySelectorAll(".gallery-item").forEach((el) => {
    el.addEventListener("click", () => openLightbox(Number(el.dataset.index)));
  });

  revealItems();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function revealItems() {
  const items = document.querySelectorAll(".gallery-item");
  if (REDUCED_MOTION) {
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const index = Number(el.dataset.index);
        // Small stagger by grid position so a batch of photos scrolling
        // into view animates in one after another rather than all at once.
        setTimeout(() => el.classList.add("is-visible"), (index % 12) * 45);
        io.unobserve(el);
      }
    });
  }, { threshold: 0.1 });
  items.forEach((el) => io.observe(el));
}

// Lightbox
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCaption = document.getElementById("lightbox-caption");

function openLightbox(index) {
  currentIndex = index;
  showCurrent();
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.hidden = true;
  document.body.style.overflow = "";
}

function showCurrent() {
  const photo = photos[currentIndex];
  lightboxImg.classList.remove("is-shown");
  const img = new Image();
  img.onload = () => {
    lightboxImg.src = img.src;
    requestAnimationFrame(() => lightboxImg.classList.add("is-shown"));
  };
  img.src = `/assets/gallery/photos/${encodeURIComponent(photo.file)}`;
  lightboxCaption.textContent = photo.caption || "";
}

function nextPhoto() {
  currentIndex = (currentIndex + 1) % photos.length;
  showCurrent();
}

function prevPhoto() {
  currentIndex = (currentIndex - 1 + photos.length) % photos.length;
  showCurrent();
}

document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
document.getElementById("lightbox-next").addEventListener("click", nextPhoto);
document.getElementById("lightbox-prev").addEventListener("click", prevPhoto);

lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (lightbox.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowRight") nextPhoto();
  if (e.key === "ArrowLeft") prevPhoto();
});

// Basic swipe support for the lightbox on mobile.
let touchStartX = null;
lightbox.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
lightbox.addEventListener("touchend", (e) => {
  if (touchStartX === null) return;
  const diff = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(diff) > 40) diff < 0 ? nextPhoto() : prevPhoto();
  touchStartX = null;
}, { passive: true });

loadGallery();
