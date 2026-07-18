# Digz N' Lidz — RC Experience Cafe

Full booking, session, ordering and analytics system for Digz N' Lidz.

Repo: github.com/Theprovisionrooms/DigzNLidz
Domain (once connected): digznlidz.co.uk

Built and maintained by Sidedoor Digital (getsidedoor.co.uk).

## Stack

- Cloudflare Pages — static site hosting
- Cloudflare Workers (Pages Functions) — API
- Cloudflare D1 — database
- Cloudflare R2 — image/asset storage
- Square — payments, till sync, catalog (deposits, session extensions, QR orders)
- Resend — transactional and marketing email

## Structure

```
/public              site pages (static)
  /seat              QR seat landing page (start session, timer, order food)
  /book              family/group booking form
  /corporate         corporate/private event enquiry form
  /assets            css, js, and generated seat QR codes
/functions           Pages Functions (API routes + shared lib)
  /api               bookings, corporate, seats, orders, mailing list, config, webhook
  /lib               Square client, D1 settings helper, Resend email helper
/workers             standalone Cron Trigger worker (session expiry), deployed separately
/migrations          D1 schema migrations
BUILD_CHECKLIST.md   internal build tracker, not client-facing
```

## Workflow

GitHub is the source of truth for this project. Cloudflare Pages is linked to this
repo for deploy only. No manual uploads outside of GitHub.

## Status

In build. See BUILD_CHECKLIST.md for current progress.

Intellectual property of Sidedoor Digital.
