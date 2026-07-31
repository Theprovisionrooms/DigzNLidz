Drop photos straight into this folder. JPG, PNG or WEBP.

Then either:
  - Double-click update-gallery.bat in the main repo folder, or
  - Run: node tools/generate-gallery-manifest.js

That rebuilds manifest.json (one folder up) from whatever's in here.
Commit and push as normal afterwards, through GitHub Desktop.

Newest photos (by file date) show first on the gallery page automatically.

Captions: each photo gets a caption guessed from its filename (dashes and
underscores become spaces), e.g. "sandpit-launch-day.jpg" becomes "sandpit
launch day". To set a better caption, open manifest.json after running the
script and edit the "caption" field for that photo, it won't get
overwritten next time as long as the filename doesn't change.

Keep individual photos under ~2MB if you can, straight-off-the-camera
files can be 5-10MB+ and will make the gallery page slow to load. Most
phones have a "resize when sharing" option, or drop them through any free
online image compressor first.
