// Run this after adding or removing photos in public/assets/gallery/photos/,
// before pushing. Regenerates manifest.json, which is what the gallery page
// actually reads, it has no way to list files in the folder itself once
// deployed.
//
// Usage:  node tools/generate-gallery-manifest.js
// Or just double-click update-gallery.bat in the repo root on Windows.

const fs = require("fs");
const path = require("path");

const PHOTOS_DIR = path.join(__dirname, "..", "public", "assets", "gallery", "photos");
const MANIFEST_PATH = path.join(__dirname, "..", "public", "assets", "gallery", "manifest.json");
const VALID_EXT = [".jpg", ".jpeg", ".png", ".webp"];

if (!fs.existsSync(PHOTOS_DIR)) {
  console.error(`Can't find ${PHOTOS_DIR}, has the folder been moved or renamed?`);
  process.exit(1);
}

// Keep any hand-written captions from the existing manifest, matched by
// filename, so re-running this script after adding new photos doesn't
// wipe out captions already added for older ones.
let existingCaptions = {};
if (fs.existsSync(MANIFEST_PATH)) {
  try {
    const existing = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    for (const p of existing.photos || []) {
      if (p.caption) existingCaptions[p.file] = p.caption;
    }
  } catch (e) {
    console.warn("Couldn't read the existing manifest, starting fresh.");
  }
}

const files = fs.readdirSync(PHOTOS_DIR)
  .filter((f) => VALID_EXT.includes(path.extname(f).toLowerCase()))
  .map((f) => ({
    file: f,
    mtime: fs.statSync(path.join(PHOTOS_DIR, f)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime); // newest first

const photos = files.map(({ file }) => ({
  file,
  caption: existingCaptions[file] || prettify(file),
}));

function prettify(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ photos }, null, 2));
console.log(`Done. ${photos.length} photo(s) in the gallery.`);
console.log(`Edit manifest.json directly if you want to change any captions, it won't be overwritten as long as the filename stays the same.`);
