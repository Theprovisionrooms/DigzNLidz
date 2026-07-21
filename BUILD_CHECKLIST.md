# Digz N' Lidz, Build Checklist

Internal tracking doc. Not for client. Update as we go so nothing gets lost across sessions.

## Setup
- [x] Build brief written and delivered
- [x] GitHub repo created, Theprovisionrooms/DigzNLidz
- [x] Project scaffold created locally
- [x] Domain confirmed, digznlidz.co.uk (to connect in Cloudflare Pages once live)
- [x] Payment provider decided, Square (matches their existing till)
- [ ] Square account access confirmed (API keys, sandbox access)
- [ ] Branding assets received (logo files, photography, digger imagery direction)
- [x] Tier names + pricing confirmed: 15 min £5, 30 min £10, 60 min £15 (migrations/0003_tier_pricing.sql)
- [x] Corporate booking process signed off, Jordan's call, existing enquiry -> confirm -> payment link flow stands as built

## Data model (D1)
- [x] bookings (type: family/group/corporate, status, date, slot, deposit_status)
- [x] seats (16 rows, seat_id, current_status, current_session_id)
- [x] sessions (seat_id, tier, start_time, end_time, extensions[])
- [x] orders (session_id or seat_id, items, status, square_order_id)
- [x] mailing_list (email, source, signup_date, tags)
- [x] discount_codes (code, campaign_id, percent/fixed, expiry, usage_limit, uses)
- [x] campaigns (name, sent_date, type)
- [x] corporate_enquiries (details, status, confirmed_by, payment_link_sent)
- [x] settings (tier config, pricing, extension price, timings), editable without redeploy

## Core booking flow
- [x] Family/group booking endpoint (creates booking, returns Square deposit checkout link)
- [x] Square payment link + webhook confirms deposit, flips booking to paid
- [x] Booking confirmation email (Resend)
- [x] Corporate enquiry endpoint (no payment)
- [x] Corporate confirm endpoint (staff-triggered, auto-generates + emails payment link)
- [x] Booking form UI (public site), /book/
- [x] Corporate enquiry UI, /corporate/
- [x] Corporate staff confirm UI, lives in the dashboard (/dashboard)

## QR seat sessions
- [x] Generate 16 unique seat QR codes, public/assets/qr/seat-1.png to seat-16.png
- [x] Seat landing page (start session / order food), /seat/?seat=N
- [x] Seat status endpoint (GET /api/seats/:id)
- [x] Start session endpoint, handles paid tiers via Square Web Payments SDK sourceId
- [x] Extend session endpoint ("add 15 min for £5", instant Square charge)
- [x] Cron worker to flip expired sessions to awaiting_extension
- [x] Public config endpoint (/api/config) for Square app/location IDs and tier pricing
- [x] Card on file: first payment of a visit saves the card, extend and food orders after that charge it directly, no re-entered card details (migrations/0002_card_on_file.sql, functions/lib/square.js, seats/[id]/start.js, extend.js, order.js)
- [x] End-of-visit endpoint (POST /api/seats/:id/end): frees the seat, disables the card on file. Also fixes a gap where a seat never went back to "free" after the customer finished, "no I'm done" and the new "I'm finished" button both call it now
- [x] Live seat state sync to dashboard, seat grid pulls from /api/dashboard/summary and polls every 10s

## Food & drink ordering
- [x] Menu and pricing now pulled from Square's catalog (functions/api/config.js, functions/lib/square.js), Mark and Danny manage items and prices themselves in Square, no code change needed on their end. Still needs live Square credentials to actually see real items instead of the fallback squash/crisps/hot dog placeholder
- [x] Order endpoint, tagged to seat + session, charged via Square sourceId
- [x] Order UI on seat page
- [x] Order sent to staff, dashboard has a live orders panel (placed/preparing/delivered)
- [x] Cafe tables (8, away from the pit): QR ordering with no digger session attached, /table/?table=N, functions/api/tables/[id]/order.js, migrations/0004_cafe_tables.sql adds table_id to orders. Every order is a fresh one-off card charge since there's no session to keep a card on file against. Dashboard orders panel labels these "Table N" instead of "Seat N" so staff know where to deliver

## Payments (Square)
- [x] Square API client (payment links, direct charge, webhook verification)
- [x] Deposit flow (bookings + corporate) via payment links
- [x] Extension + food/drink charges via Square Web Payments SDK sourceId
- [x] Card on file, saves after first payment of a visit, charges direct after that
- [ ] Square sandbox credentials added to test end to end, still the main blocker
- [x] Food/drink catalogue synced from Square, decided against manual entry so Mark and Danny keep control of their own menu and pricing

## Promotions & mailing list
- [x] Signup capture endpoint
- [x] Booking confirmation auto-adds to mailing list
- [x] Resend templates styled to brand (functions/lib/email.js, brandedEmail wrapper, used on booking confirmation, corporate deposit link, corporate deposit confirmation)
- [x] Cron-triggered automated campaigns, workers/winback-cron.js, weekly, finds lapsed subscribers, generates a 10% code, emails it, tracks who's been sent to so it doesn't repeat. Deploys separately, see workers/wrangler-winback.toml
- [x] Discount code redemption logic wired into booking checkout
- [x] Dashboard: create discount codes, view redemption counts

## Content pages
- [x] Home, real logo, hazard divider, floating digger artwork, links out
- [x] Book, /book/
- [x] Corporate, /corporate/
- [x] Blog, /blog/, JSON-driven (public/blog/posts.json), add posts by editing that file
- [x] Podcast page, /podcast/, placeholder Spotify/Apple embeds, needs real show links
- [x] FAQ, /faq/ (with FAQPage schema for SEO/AI discoverability)
- [x] Contact, /contact/, general enquiries, emails the venue via Resend

## Design & animation
- [x] Real logo and brand colours in use (black/yellow/rust, from actual logo, not a generic placeholder)
- [x] Digger artwork sourced from Jordan (3 transparent PNGs, optimised to webp, ~100KB each)
- [x] Floating/drifting digger animation (CSS only, no JS cost), hidden on small screens to avoid clutter
- [x] Hazard stripe divider component
- [x] Boot/intro animation, micro-interactions: session-scoped boot sequence on load, signature hero digger with dig animation and dust, patrol animation + dust on background diggers (homepage only, other pages keep the original gentle drift), CTA idle pulse + hover lift
- [x] Front-of-house pages (book, corporate, contact, faq, blog, podcast) now match the homepage treatment: logo header, styled form fields, hazard-rule footer, real webfonts. Per Jordan's brief, only the seat/QR flow stays deliberately lean, that's intentional, not unfinished
- [x] Homepage rebuilt: hero, offer pillars, real "how your visit runs" sequence, blog/podcast/FAQ hub teaser, Oswald and Barlow now actually loading as webfonts (public/index.html, public/assets/css/home.css)
- [x] Dashboard gets a light logo touch (internal tool, kept functional rather than richly styled, on purpose)
- [x] Sandpit background: texture-bg reworked with warm sand-toned glows plus a raked crosshatch groove texture, subtle, doesn't hurt readability
- [x] Hero digger now shows on all screen sizes including phones, it was previously hidden below 480px which is what caused it to be missing on Jordan's iPhone. Sized down progressively rather than hidden, phone experience prioritised over desktop per Jordan's steer
- [x] Mobile hero was flat, added a price/urgency hook line under the hero CTAs plus a sticky mobile-only "Book now" bar that appears once the hero scrolls out of view, so there's always a live path to booking

## Dashboard (owner-facing)
- [x] Password-gated access (/dashboard, shared staff password, signed session cookie)
- [x] Live seat status view (colour-coded grid)
- [x] Bookings overview (today by type, this week total)
- [x] Revenue breakdown (deposits / extensions / food & drink)
- [x] Mailing list growth (current total, trend over time), weekly signup counts, last 8 weeks
- [x] Corporate enquiries: confirm + auto-send payment link, right from the dashboard
- [x] Live orders panel, mark preparing/delivered (functions/api/dashboard/orders.js, was previously marked done but the panel was never actually wired up, fixed now)
- [x] Promo/campaign performance, redemptions rolled up per campaign not just per code
- [x] Site traffic + conversion: no code needed, Cloudflare auto-injects the beacon once Web Analytics is enabled on the Pages project (Metrics tab), there's no snippet to add to the homepage

## SEO / AI discoverability
- [x] LocalBusiness schema (homepage) + FAQPage schema (/faq/)
- [x] Sitemap
- [x] Problem/solution copy on key pages: homepage pillars already covered this, added real intros + stronger meta descriptions to blog, podcast, contact and FAQ, book and corporate already had it

## Handover
- [x] README written
- [x] Owner guide written, DigzNLidz_Owner_Guide.docx, delivered separately, not stored in repo
- [x] Legal/IP notice added, README + homepage footer
