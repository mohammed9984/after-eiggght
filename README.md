# AFTER 8: digital menu + AFTER 8 CLUB

Mobile-first QR menu (Arabic/English, EGP), customer loyalty card, staff validation screen and owner dashboard.
Node 22.13+ only. **No npm dependencies, no build step.** SQLite (built into Node) is the database.

## Run it
```bash
cp .env.example .env      # then edit it (see below)
node server/index.js      # http://localhost:3000
npm test                  # 11 server-side rule tests
```

## Configuration (the server tells you what is missing)
| Variable | Needed for | If missing |
|---|---|---|
| `OWNER_EMAIL`, `OWNER_PASSWORD` (10+ chars) | Creates the owner account on first start | Owner dashboard stays locked. No default password exists. Console + dashboard banner explain this. |
| `BASE_URL` (`https://your-domain`) | Where table QR codes point | QR codes point at localhost; dashboard warns until set. |
| `DATA_DIR` | Where `after8.db` lives | Defaults to `./data`. **On a host, mount a persistent volume here**, otherwise data is lost on redeploy. |
| `SESSION_SECRET` | Optional | A random secret is generated once and stored in the database. |

Host over **https**: phones only allow camera scanning on secure pages, and cookies are marked `Secure` when `BASE_URL` is https.
Any host that runs a long-lived Node process with a persistent disk works (VPS, Fly.io, Railway with volume). Serverless hosts with ephemeral disks do not.

## Roles
- **Customer**: signs up with email or mobile + password; sees card, QR, member code, reward.
- **Staff**: created by the owner. Looks up customers, validates paid visits, redeems rewards.
- **Owner**: bootstrapped from env. Menu, prices, availability, reward eligibility, loyalty rules, staff accounts, table QR codes, activity log.

## Loyalty rules (all enforced in `server/app.js`, inside database transactions)
- A stamp exists only when a signed-in staff member validates a paid visit (bill amount + unique receipt number). The public menu and its QR are read-only and cannot create one.
- Customer QR = signed token that expires after 90 s and refreshes itself (a screenshot is useless later). Manual fallback: 8-character member code.
- Staff must look the customer up first; the resulting short-lived grant is bound to that staff member and customer.
- Guards: unique receipt number, idempotency key (double-taps/retries stamp once), cooldown between stamps (default 240 min), minimum bill, no stamps while a reward is waiting, one reward per card (database `UNIQUE`), reward flips `available→redeemed` atomically so it cannot be redeemed twice.
- 5 stamps unlock the reward; it can be redeemed on a **later day** (setting, default on), then a new card starts. The redemption visit does not add a stamp.
- Owner picks which products can be claimed as the reward (“Reward item” on each product). Until at least one is chosen, staff cannot redeem.

## Menu data
Transcribed from the supplied menu pages (`docs/menu-reference/`). Page 1 (Hot/Filter/Iced Coffee) was not supplied, so those categories exist but are empty and hidden from customers until you add items. Items needing a decision are flagged in the dashboard under **To verify**; unverified prices are never shown to customers (they see “Ask at the counter”). Arabic names are drafts to review.

## Photos and fonts
Drop `public/assets/storefront.jpg` in place; the hero uses it automatically (nothing generic is substituted). Fonts (Anton, Archivo, Cairo, Mrs Saint Delafield) load from Google Fonts with fallbacks; self-host them if you want zero third-party requests.

## Not built (needs outside services or your decision)
Phone/email verification and password-reset emails (needs an SMS/email provider), reward expiry, Arabic translation of the owner dashboard, iOS Safari camera scanning (`BarcodeDetector` is unavailable there; manual code works).
