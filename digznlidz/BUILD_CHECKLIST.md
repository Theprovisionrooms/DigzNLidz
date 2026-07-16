# Digz N' Lidz — Build Checklist

Internal tracking doc. Not for client. Update as we go so nothing gets lost across sessions.

## Setup
- [x] Build brief written and delivered
- [x] GitHub repo created — Theprovisionrooms/DigzNLidz
- [x] Project scaffold created locally
- [x] Domain confirmed — digznlidz.co.uk (to connect in Cloudflare Pages once live)
- [x] Payment provider decided — Square (matches their existing till)
- [ ] Square account access confirmed (API keys, sandbox access)
- [ ] Branding assets received (logo files, photography, digger imagery direction)
- [ ] Tier names + pricing confirmed (currently Tier 1/2/3, 15/30/60 min)
- [ ] Corporate booking process signed off

## Data model (D1)
- [x] bookings (type: family/group/corporate, status, date, slot, deposit_status)
- [x] seats (16 rows, seat_id, current_status, current_session_id)
- [x] sessions (seat_id, tier, start_time, end_time, extensions[])
- [x] orders (session_id or seat_id, items, status, square_order_id)
- [x] mailing_list (email, source, signup_date, tags)
- [x] discount_codes (code, campaign_id, percent/fixed, expiry, usage_limit, uses)
- [x] campaigns (name, sent_date, type)
- [x] corporate_enquiries (details, status, confirmed_by, payment_link_sent)
- [x] settings (tier config, pricing, extension price, timings) — editable without redeploy

## Core booking flow
- [x] Family/group booking endpoint (creates booking, returns Square deposit checkout link)
- [x] Square payment link + webhook confirms deposit, flips booking to paid
- [x] Booking confirmation email (Resend)
- [x] Corporate enquiry endpoint (no payment)
- [x] Corporate confirm endpoint (staff-triggered, auto-generates + emails payment link)
- [x] Booking form UI (public site) — /book/
- [x] Corporate enquiry UI — /corporate/
- [ ] Corporate staff confirm UI (currently API only, no internal screen yet)

## QR seat sessions
- [x] Generate 16 unique seat QR codes — public/assets/qr/seat-1.png to seat-16.png
- [x] Seat landing page (start session / order food) — /seat/?seat=N
- [x] Seat status endpoint (GET /api/seats/:id)
- [x] Start session endpoint, handles paid tiers via Square Web Payments SDK sourceId
- [x] Extend session endpoint ("add 15 min for £5", instant Square charge)
- [x] Cron worker to flip expired sessions to awaiting_extension
- [x] Public config endpoint (/api/config) for Square app/location IDs and tier pricing
- [ ] Live seat state sync to dashboard (build once dashboard exists)

## Food & drink ordering
- [ ] Real menu and pricing from Digz N' Lidz — currently placeholder items (squash/crisps/hot dog) in seat.js
- [x] Order endpoint, tagged to seat + session, charged via Square sourceId
- [x] Order UI on seat page
- [ ] Order sent to staff (screen or email/print, TBC)

## Payments (Square)
- [x] Square API client (payment links, direct charge, webhook verification)
- [x] Deposit flow (bookings + corporate) via payment links
- [x] Extension + food/drink charges via Square Web Payments SDK sourceId
- [ ] Square sandbox credentials added to test end to end
- [ ] Food/drink catalogue synced from Square (or confirmed as manual entry)

## Promotions & mailing list
- [x] Signup capture endpoint
- [x] Booking confirmation auto-adds to mailing list
- [ ] Resend templates styled to brand
- [ ] Cron-triggered automated campaigns (e.g. win-back)
- [ ] Discount code redemption logic wired into checkout

## Content pages
- [ ] Home
- [ ] Book (family/group/corporate)
- [ ] Blog (flat markdown, build-time render)
- [ ] Podcast page
- [ ] FAQ
- [ ] Contact

## Design & animation
- [ ] Brand palette + type locked in (black/yellow/rust, industrial stencil)
- [ ] Digger artwork direction confirmed with Jordan
- [ ] Boot/intro animation
- [ ] Micro-interactions (buttons, transitions)

## Dashboard (owner-facing)
- [ ] Live seat status view
- [ ] Bookings overview (today/week, by type)
- [ ] Revenue breakdown (seat time / extensions / food / deposits)
- [ ] Promo/campaign performance
- [ ] Mailing list growth
- [ ] Site traffic + conversion

## SEO / AI discoverability
- [ ] LocalBusiness + FAQ schema
- [ ] Sitemap
- [ ] Problem/solution copy on key pages

## Handover
- [ ] README written
- [ ] Owner guide written
- [ ] Legal/IP notice added
