DIGZ N' LIDZ, BUG FIX PACKAGE
==============================

Drop these files into your repo folder exactly as laid out here (same
paths), then commit and push through GitHub Desktop as usual. Nothing here
touches wrangler.toml.

WHAT'S CHANGED, AND WHY

1. functions/api/dashboard/discount-codes.js
   Creating a discount code that already exists now returns a proper
   "that code's already in use" message instead of crashing with a raw
   database error.

2. functions/lib/auth.js, functions/api/auth/login.js
   The staff login now locks an IP address out for 15 minutes after 5
   wrong password attempts in a row, so the shared dashboard password
   can't just be guessed at repeatedly. Needs the new migration below.

3. public/assets/js/dashboard.js, public/assets/js/kitchen.js
   Both login screens now show the real error from the server (so the
   new lockout message above actually shows up) instead of always
   saying "incorrect password".

4. public/assets/js/dashboard.js (PIT_LAYOUT comment only)
   Just a comment fix, no behaviour change. Confirmed with Jordan that
   the seat numbering in the dashboard's pit map is the source of truth,
   QR stickers get placed to match it, not the other way round, so
   there was nothing to actually correct here.

5. public/assets/js/book.js
   The booking form's "we're closed that day" check now works out the
   day of the week the same way the server does, so it can't show a
   misleading message to someone browsing from outside the UK.

6. functions/_middleware.js
   The maintenance-mode preview link (?preview=...) now checks against
   its own separate MAINTENANCE_PREVIEW_KEY rather than the real staff
   dashboard password, so sharing a preview link never hands over the
   actual login. See "ONE THING YOU NEED TO DO" below.

7. migrations/0017_login_attempts.sql
   New table backing the login lockout in point 2. Apply it the normal
   way once this is pushed:

       wrangler d1 migrations apply digznlidz-db --remote

ONE THING YOU NEED TO DO

Add a new secret in Cloudflare Pages, Settings, Environment variables:

    MAINTENANCE_PREVIEW_KEY = (any password you like, different from
                                your dashboard password)

Until you add it, preview links still work exactly as before (it falls
back to the dashboard password automatically), so nothing breaks if you
push this before setting the new secret. Once it's set, use that value
in your preview links instead, e.g.
https://digznlidz.co.uk/?preview=whatever-you-set

The updated dev manual (DigzNLidz-Dev-Manual.md) has the full detail on
all of the above if needed later.
