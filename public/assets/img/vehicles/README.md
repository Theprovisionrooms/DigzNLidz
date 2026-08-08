Drop transparent-background PNGs here with these exact filenames (matches
`image_path` in migrations/0018_vehicle_models.sql — rename the column
there too if you'd rather use different filenames):

- metal-excavator.png
- huina-excavator-diecast.png
- excavator-v5.png
- 8-wheel-loader.png
- wheel-loader-v2.png
- scania-770s-red.png
- scania-770s-green.png
- tower-crane.png

Used at ~96x72px on the seat/booking picker cards (see .vehicle-option img
in base.css), so anything reasonably square-ish and at least ~400px wide
will look sharp without being a huge download on mobile data.
